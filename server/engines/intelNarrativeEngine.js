const db = require('../db');
const { getMcpClient } = require('../mcp/fmpClient');

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

        const narrative = `
${headline}

Market Context:
Sector: ${context.sector || 'unknown'}
Price: ${context.price || 'unknown'}

Interpretation:
This headline may influence sentiment within the sector and could
increase short-term volatility depending on broader market conditions.
`;

        await db.query(
          `UPDATE intel_news
           SET narrative = $1,
               detected_symbols = $2,
               catalyst_type = $3,
               expected_move = $4
           WHERE id = $5`,
          [
            narrative,
            symbol ? [symbol] : null,
            classifyCatalyst(headline),
            inferExpectedMove(headline),
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

module.exports = { runIntelNarrativeEngine };
