const axios = require('axios');

const { supabaseAdmin } = require('../../services/supabaseClient');

const MAX_SYMBOLS_PER_RUN = 200;
const MAX_ARTICLES_PER_SYMBOL = 5;
const RSS_TIMEOUT_MS = 1000;

const rssClient = axios.create({
	timeout: RSS_TIMEOUT_MS,
	validateStatus: () => true,
});

let ingestInFlight = false;

function decodeXmlEntities(value) {
	return String(value || '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function extractTag(block, tagName) {
	const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
	return match ? decodeXmlEntities(match[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : null;
}

function parseYahooRss(xml) {
	const items = [];
	const matches = String(xml || '').match(/<item>([\s\S]*?)<\/item>/gi) || [];

	for (const itemXml of matches) {
		const headline = extractTag(itemXml, 'title');
		const url = extractTag(itemXml, 'link');
		const publishedAt = extractTag(itemXml, 'pubDate');
		const source = extractTag(itemXml, 'source') || 'Yahoo Finance';

		if (!headline || !url || !publishedAt) {
			continue;
		}

		const parsedTime = Date.parse(publishedAt);
		if (Number.isNaN(parsedTime)) {
			continue;
		}

		items.push({
			headline,
			url,
			published_at: new Date(parsedTime).toISOString(),
			source,
		});
	}

	return items;
}

async function fetchTargetSymbols(limit = MAX_SYMBOLS_PER_RUN) {
	if (!supabaseAdmin) {
		throw new Error('Supabase admin client unavailable');
	}

	const result = await supabaseAdmin
		.from('market_quotes')
		.select('symbol, price, volume')
		.gt('price', 0)
		.gt('volume', 0)
		.order('volume', { ascending: false })
		.limit(Math.min(limit, MAX_SYMBOLS_PER_RUN));

	if (result.error) {
		throw new Error(result.error.message || 'Failed to load Yahoo ingestion symbols');
	}

	const seen = new Set();
	const symbols = [];

	for (const row of result.data || []) {
		const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : null;
		if (!symbol || seen.has(symbol)) {
			continue;
		}

		seen.add(symbol);
		symbols.push(symbol);
	}

	return symbols;
}

async function fetchExistingHeadlines(symbol) {
	const existing = new Set();
	let from = 0;
	const pageSize = 500;

	while (true) {
		const result = await supabaseAdmin
			.from('news_articles')
			.select('headline')
			.eq('symbol', symbol)
			.range(from, from + pageSize - 1);

		if (result.error) {
			throw new Error(result.error.message || `Failed to load existing Yahoo headlines for ${symbol}`);
		}

		const rows = Array.isArray(result.data) ? result.data : [];
		for (const row of rows) {
			if (row?.headline) {
				existing.add(String(row.headline).trim());
			}
		}

		if (rows.length < pageSize) {
			break;
		}

		from += pageSize;
	}

	return existing;
}

async function fetchYahooArticlesForSymbol(symbol) {
	const response = await rssClient.get('https://feeds.finance.yahoo.com/rss/2.0/headline', {
		params: {
			s: symbol,
			region: 'US',
			lang: 'en-US',
		},
		responseType: 'text',
	});

	if (response.status < 200 || response.status >= 300) {
		return [];
	}

	return parseYahooRss(response.data).slice(0, MAX_ARTICLES_PER_SYMBOL);
}

async function insertYahooArticle(symbol, article) {
	const payload = {
		symbol,
		symbols: [symbol],
		headline: article.headline,
		title: article.headline,
		source: 'yahoo',
		provider: article.source || 'Yahoo Finance',
		source_type: 'RSS',
		url: article.url,
		source_url: article.url,
		published_at: article.published_at,
		published_date: article.published_at,
		ingested_at: new Date().toISOString(),
	};

	const result = await supabaseAdmin.from('news_articles').insert(payload);
	if (result.error) {
		throw new Error(result.error.message || `Failed to insert Yahoo article for ${symbol}`);
	}
}

async function runYahooNewsIngest(options = {}) {
	if (ingestInFlight) {
		return {
			success: false,
			reason: 'already_running',
			symbols_scanned: 0,
			inserted: 0,
			duplicates: 0,
		};
	}

	ingestInFlight = true;

	try {
		const symbols = await fetchTargetSymbols(options.limit);
		let inserted = 0;
		let duplicates = 0;
		let errors = 0;

		for (const symbol of symbols) {
			let existingHeadlines;
			try {
				existingHeadlines = await fetchExistingHeadlines(symbol);
			} catch (error) {
				console.warn('[YAHOO_NEWS_INGEST] existing headline lookup failed', { symbol, error: error.message });
				errors += 1;
				continue;
			}

			let articles;
			try {
				articles = await fetchYahooArticlesForSymbol(symbol);
			} catch (error) {
				console.warn('[YAHOO_NEWS_INGEST] RSS fetch failed', { symbol, error: error.message });
				errors += 1;
				continue;
			}

			for (const article of articles) {
				if (existingHeadlines.has(article.headline)) {
					duplicates += 1;
					continue;
				}

				try {
					await insertYahooArticle(symbol, article);
					existingHeadlines.add(article.headline);
					inserted += 1;
				} catch (error) {
					console.warn('[YAHOO_NEWS_INGEST] insert failed', { symbol, headline: article.headline, error: error.message });
					errors += 1;
				}
			}
		}

		const summary = {
			success: true,
			symbols_scanned: symbols.length,
			inserted,
			duplicates,
			errors,
		};

		console.log('[YAHOO_NEWS_INGEST] run complete', summary);
		return summary;
	} finally {
		ingestInFlight = false;
	}
}

module.exports = {
	runYahooNewsIngest,
};
