const path = require('path');
const dotenv = require('dotenv');
const pool = require('../server/db/pool');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'server', '.env') });

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const fmpKey = process.env.FMP_API_KEY;

if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL/DATABASE_URL');
if (!fmpKey) throw new Error('Missing FMP_API_KEY');

const toIsoTimestamp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
};

(async () => {
  try {
    const symbol = 'AAPL';
    const url = `https://financialmodelingprep.com/stable/news/stock-latest?symbols=${encodeURIComponent(symbol)}&limit=25&apikey=${encodeURIComponent(fmpKey)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`FMP failed: ${response.status}`);
    }

    const payload = await response.json();
    const rows = (Array.isArray(payload) ? payload : [])
      .map((row) => ({
        symbol,
        published_at: toIsoTimestamp(row?.publishedDate || row?.published_at || row?.date),
        headline: String(row?.title || row?.headline || '').trim(),
        source: String(row?.site || row?.source || '').trim() || null,
        url: String(row?.url || '').trim() || null,
      }))
      .filter((row) => row.published_at && row.headline)
      .slice(0, 10);

    let touched = 0;
    for (const row of rows) {
      const result = await pool.query(
        `INSERT INTO public.news_events (symbol, published_at, headline, source, url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (symbol, published_at, headline)
         DO UPDATE SET source = EXCLUDED.source, url = EXCLUDED.url
         RETURNING id`,
        [row.symbol, row.published_at, row.headline, row.source, row.url],
      );
      touched += result.rowCount || 0;
    }

    const countResult = await pool.query('SELECT count(*)::int AS count FROM public.news_events');
    const total = Number(countResult.rows?.[0]?.count || 0);

    console.log(JSON.stringify({
      ok: true,
      rowsFetched: rows.length,
      rowsTouched: touched,
      totalNewsRows: total,
      firstFiveReady: total >= 5,
    }, null, 2));
  } finally {
    await pool.end();
  }
})();
