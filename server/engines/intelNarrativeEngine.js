const db = require('../db');
const { getMcpClient } = require('../mcp/fmpClient');

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function classifyCatalyst(headline) {
  const h = String(headline || '').toLowerCase();
  if (/earnings|guidance|eps|revenue/.test(h)) return 'earnings';
  if (/upgrade|downgrade|target|analyst/.test(h)) return 'analyst';
  if (/deal|acquisition|merger|partnership/.test(h)) return 'corporate';
  if (/fda|approval|trial/.test(h)) return 'biotech';
  return 'news';
}

function inferExpectedMove(headline) {
  const h = String(headline || '');
  const pct = h.match(/(\d+(?:\.\d+)?)\s?%/);
  if (!pct) return null;
  const value = Number(pct[1]);
  return Number.isFinite(value) ? value : null;
}

function buildScoreBreakdown({ headline, context, symbol }) {
  const h = String(headline || '').toLowerCase();
  const hasMacro = /fed|rates|cpi|inflation|treasury|macro|jobs/.test(h);
  const hasMomentumWords = /surge|breakout|rally|momentum|strength|squeeze/.test(h);
  const hasSentimentWords = /beat|miss|upgrade|downgrade|guidance|warning/.test(h);
  const hasClusterWords = /ai|semiconductor|chip|software|energy|biotech|bank/.test(h);

  const newsVolume = clamp((String(headline || '').length > 120 ? 0.34 : 0.26) + (symbol ? 0.03 : 0), 0.18, 0.4);
  const sentiment = clamp((hasSentimentWords ? 0.2 : 0.12), 0.08, 0.25);
  const clustering = clamp((hasClusterWords ? 0.22 : 0.15), 0.1, 0.26);
  const macroAlignment = clamp((hasMacro ? 0.18 : 0.1), 0.06, 0.22);
  const momentum = clamp((hasMomentumWords ? 0.17 : 0.11) + (toNum(context?.price) > 0 ? 0.01 : 0), 0.08, 0.22);

  return {
    newsVolume,
    sentiment,
    clustering,
    macroAlignment,
    momentum,
  };
}

function inferNarrativeType(headline, symbol) {
  const h = String(headline || '').toLowerCase();
  if (/fed|rates|inflation|jobs|macro|treasury/.test(h)) return 'macro';
  if (symbol) return 'single stock';
  return 'sector';
}

function inferTimeHorizon(headline) {
  const h = String(headline || '').toLowerCase();
  if (/guidance|outlook|multi-year|long term|fiscal/.test(h)) return 'macro';
  if (/earnings|upgrade|downgrade|catalyst/.test(h)) return 'swing';
  return 'intraday';
}

function inferRegime(scoreBreakdown) {
  const total = toNum(scoreBreakdown?.sentiment) + toNum(scoreBreakdown?.momentum) + toNum(scoreBreakdown?.macroAlignment);
  if (total >= 0.5) return 'bullish';
  if (total <= 0.3) return 'bearish';
  return 'neutral';
}

function detectTheme(headline = '') {
  const h = String(headline || '').toLowerCase();
  if (/chip|semiconductor|ai|gpu|software|cloud/.test(h)) return 'technology';
  if (/bank|yield|credit|treasury|financial/.test(h)) return 'financials';
  if (/oil|gas|opec|energy/.test(h)) return 'energy';
  if (/fda|trial|drug|health|biotech/.test(h)) return 'healthcare';
  if (/retail|consumer|discretionary/.test(h)) return 'consumer';
  return 'broad-market';
}

function composeNarrative({ headline, symbol, context, regime, timeHorizon, catalystType, expectedMove, scoreBreakdown }) {
  const sector = context?.sector || detectTheme(headline);
  const tickerText = symbol ? `${symbol} is the immediate focus` : 'This is a cross-symbol setup';
  const moveText = Number.isFinite(expectedMove)
    ? `Headline-implied move risk is near ${expectedMove.toFixed(1)}%.`
    : 'No explicit move guidance was parsed from the headline.';

  const strength = (Number(scoreBreakdown?.sentiment || 0) + Number(scoreBreakdown?.momentum || 0)) >= 0.32
    ? 'momentum-confirming'
    : 'headline-sensitive';

  const sectorPlaybook = {
    technology: 'Watch for continuation through prior day highs with volume expansion and relative strength versus QQQ.',
    financials: 'Track reaction to yields and watch for failed breakdowns around VWAP before chasing strength.',
    energy: 'Confirm commodity follow-through and favor setups aligned with crude direction after the open.',
    healthcare: 'Prioritize catalyst-driven levels; avoid late entries without sustained tape support.',
    consumer: 'Focus on opening range breaks only if RVOL remains elevated through the first pullback.',
    'broad-market': 'Use index confirmation (SPY/QQQ) and breadth before sizing into continuation trades.',
  };

  return [
    `${headline}`,
    '',
    `Context: ${tickerText}. Sector/theme signal maps to ${sector}.`,
    `Signal profile: ${strength}, ${regime} regime, ${timeHorizon} horizon, catalyst type ${catalystType}.`,
    moveText,
    sectorPlaybook[sector] || sectorPlaybook['broad-market'],
  ].join('\n');
}

async function ensureIntelNarrativeColumns() {
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS narrative TEXT`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS detected_symbols TEXT[]`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS catalyst_type TEXT`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS expected_move NUMERIC`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS score_breakdown JSONB`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS narrative_confidence NUMERIC`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS narrative_type TEXT`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS time_horizon TEXT`);
  await db.query(`ALTER TABLE intel_news ADD COLUMN IF NOT EXISTS regime TEXT`);
}

function parseQuoteData(quote) {
  const data = quote?.structured_content?.data?.[0]
    || quote?.structuredContent?.data?.[0]
    || quote?.data?.[0]
    || quote?.content?.[0]
    || null;

  if (!data || typeof data !== 'object') {
    return { price: null, sector: null, marketCap: null };
  }

  return {
    price: data.price ?? null,
    sector: data.sector ?? null,
    marketCap: data.marketCap ?? data.market_cap ?? null,
  };
}

async function runIntelNarrativeEngine() {
  console.log('[INTEL] narrative engine running');

  try {
    await ensureIntelNarrativeColumns();
    const client = await getMcpClient();

    const res = await db.query(`
      SELECT id, headline
      FROM (
        SELECT id, headline, updated_at, published_at AS created_at, narrative
        FROM intel_news
      ) n
      WHERE n.narrative IS NULL
      ORDER BY COALESCE(n.updated_at, n.created_at) DESC
      LIMIT 20
    `);

    let processed = 0;

    for (const row of res.rows) {
      try {
        const headline = row.headline;

        // Simple ticker detection from uppercase tokens.
        const matches = String(headline || '').match(/\b[A-Z]{2,5}\b/g);
        const symbol = matches ? matches[0] : null;

        let context = {};

        if (symbol && client) {
          const quote = await client.call_tool('quote', { symbol });
          const quoteData = parseQuoteData(quote);
          context.price = quoteData.price;
          context.sector = quoteData.sector;
          context.marketCap = quoteData.marketCap;
        }

        const scoreBreakdown = buildScoreBreakdown({ headline, context, symbol });
        const confidence = clamp(
          scoreBreakdown.newsVolume
          + scoreBreakdown.sentiment
          + scoreBreakdown.clustering
          + scoreBreakdown.macroAlignment
          + scoreBreakdown.momentum,
          0,
          1
        );
        const narrativeType = inferNarrativeType(headline, symbol);
        const timeHorizon = inferTimeHorizon(headline);
        const regime = inferRegime(scoreBreakdown);

        const catalystType = classifyCatalyst(headline);
        const expectedMove = inferExpectedMove(headline);
        const narrative = composeNarrative({
          headline,
          symbol,
          context,
          regime,
          timeHorizon,
          catalystType,
          expectedMove,
          scoreBreakdown,
        });

        await db.query(
          `UPDATE intel_news
           SET narrative = $1,
               detected_symbols = $2,
               catalyst_type = $3,
               expected_move = $4,
               score_breakdown = $5,
               narrative_confidence = $6,
               narrative_type = $7,
               time_horizon = $8,
               regime = $9
           WHERE id = $10`,
          [
            narrative,
            symbol ? [symbol] : null,
            catalystType,
            expectedMove,
            scoreBreakdown,
            confidence,
            narrativeType,
            timeHorizon,
            regime,
            row.id,
          ]
        );

        processed += 1;
      } catch (rowError) {
        console.warn('[INTEL] row failed', rowError.message);
      }
    }

    console.log(`[INTEL] narratives created: ${processed}`);
  } catch (error) {
    console.error('[INTEL ENGINE ERROR]', error.message);
  }
}

module.exports = {
  runIntelNarrativeEngine,
  buildScoreBreakdown,
};
