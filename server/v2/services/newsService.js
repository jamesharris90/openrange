const { supabaseAdmin } = require('../../services/supabaseClient');

async function getNewsRows() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client unavailable');
  }

  const cutoff = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();

  const { data: newsArticles, error: newsError } = await supabaseAdmin
    .from('news_articles')
    .select('id, symbol, headline, source, published_at')
    .gte('published_at', cutoff)
    .not('headline', 'is', null)
    .order('published_at', { ascending: false })
    .limit(50);

  if (newsError) {
    throw new Error(newsError.message || 'Failed to load news_articles');
  }

  const { data: intelNews, error: intelError } = await supabaseAdmin
    .from('intel_news')
    .select('id, symbol, headline, source, published_at')
    .gte('published_at', cutoff)
    .not('headline', 'is', null)
    .neq('source', 'earnings_events')
    .order('published_at', { ascending: false })
    .limit(50);

  if (intelError) {
    throw new Error(intelError.message || 'Failed to load intel_news');
  }

  const normalizedRows = [];

  for (const row of newsArticles || []) {
    const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
    if (!headline) continue;
    if (/\bearnings event\b/i.test(headline)) continue;
    normalizedRows.push({
      source_id: row.id != null ? String(row.id) : null,
      symbol: typeof row.symbol === 'string' && row.symbol.trim() ? row.symbol.trim().toUpperCase() : null,
      headline,
      source: row.source || null,
      published_at: row.published_at || null,
    });
  }

  for (const row of intelNews || []) {
    const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
    if (!headline) continue;
    if (/\bearnings event\b/i.test(headline)) continue;
    normalizedRows.push({
      source_id: row.id != null ? String(row.id) : null,
      symbol: typeof row.symbol === 'string' && row.symbol.trim() ? row.symbol.trim().toUpperCase() : null,
      headline,
      source: row.source || null,
      published_at: row.published_at || null,
    });
  }

  normalizedRows.sort((left, right) => {
    const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
    const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
    return rightTime - leftTime;
  });

  return normalizedRows.slice(0, 50);
}

module.exports = {
  getNewsRows,
};