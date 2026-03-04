const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), 'server', '.env') });
const { Client } = require('pg');

const base = process.env.SERVER_BASE_URL || 'http://localhost:3000';
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const queries = {
  symbolCount: `SELECT count(DISTINCT symbol)::bigint AS c FROM daily_ohlc`,
  dailyRows: `SELECT count(*)::bigint AS c FROM daily_ohlc`,
  intradayRows: `SELECT count(*)::bigint AS c FROM intraday_1m`,
  earningsRows: `SELECT count(*)::bigint AS c FROM earnings_events`,
  newsRows: `SELECT count(*)::bigint AS c FROM news_events`,
  activeSymbols30d: `SELECT count(DISTINCT symbol)::bigint AS c FROM daily_ohlc WHERE date >= current_date - interval '30 days'`,
  news20d: `SELECT count(*)::bigint AS c FROM news_events WHERE published_at >= now() - interval '20 days'`,
  newsOld60d: `SELECT count(*)::bigint AS c FROM news_events WHERE published_at < now() - interval '60 days'`,
  dupDaily: `SELECT count(*)::bigint AS c FROM (SELECT symbol,date,count(*) FROM daily_ohlc GROUP BY symbol,date HAVING count(*)>1) t`,
  dupIntraday: `SELECT count(*)::bigint AS c FROM (SELECT symbol,timestamp,count(*) FROM intraday_1m GROUP BY symbol,timestamp HAVING count(*)>1) t`,
  dupEarnings: `SELECT count(*)::bigint AS c FROM (SELECT symbol,report_date,count(*) FROM earnings_events GROUP BY symbol,report_date HAVING count(*)>1) t`,
  dupNews: `SELECT count(*)::bigint AS c FROM (SELECT symbol,published_at,headline,count(*) FROM news_events GROUP BY symbol,published_at,headline HAVING count(*)>1) t`,
};

async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch (_error) {
    body = null;
  }
  return { status: res.status, body };
}

(async () => {
  const pg = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const m = {};
  for (const [k, q] of Object.entries(queries)) {
    const r = await pg.query(q);
    m[k] = Number(r.rows?.[0]?.c || 0);
  }

  const cDaily = await getJson(`${base}/api/v5/chart?symbol=AAPL&timeframe=1D`);
  const c1m = await getJson(`${base}/api/v5/chart?symbol=AAPL&timeframe=1m`);
  const events = await getJson(`${base}/api/v5/events?symbol=AAPL`);
  const news = await getJson(`${base}/api/v5/news?symbol=AAPL&limit=10`);
  const search = await getJson(`${base}/api/v5/search?q=APP`);
  const scanner = await getJson(`${base}/api/v3/screener/technical?priceMin=5&volumeMin=1000000&limit=200`);

  const candles1d = Array.isArray(cDaily.body?.candles) ? cDaily.body.candles.length : 0;
  const candles1m = Array.isArray(c1m.body?.candles) ? c1m.body.candles.length : 0;
  const earningsN = Array.isArray(events.body?.earnings) ? events.body.earnings.length : 0;
  const newsN = Array.isArray(news.body) ? news.body.length : 0;
  const searchHasAAPL = Array.isArray(search.body)
    ? search.body.some((x) => String(x?.symbol || '').toUpperCase() === 'AAPL')
    : false;

  const scannerRows = Array.isArray(scanner.body?.data) ? scanner.body.data : [];
  const scannerFiltered = scannerRows.filter((r) => Number(r?.price) > 5
    && Number(r?.volume) > 1_000_000
    && Number(r?.price) > Number(r?.sma20)).length;

  const checks = {
    dailyComplete: m.dailyRows >= m.symbolCount * 400,
    intradayComplete: m.intradayRows >= m.activeSymbols30d * 20 * 390,
    earningsComplete: m.earningsRows >= m.symbolCount,
    newsRecent: m.news20d > 0,
    dupFree: m.dupDaily === 0 && m.dupIntraday === 0 && m.dupEarnings === 0 && m.dupNews === 0,
    newsCleanup: m.newsOld60d === 0,
    apiChart: cDaily.status === 200 && c1m.status === 200 && candles1d > 200 && candles1m > 1000,
    apiEvents: events.status === 200 && earningsN > 0,
    apiNews: news.status === 200 && (m.news20d === 0 || newsN > 0),
    apiSearch: search.status === 200 && searchHasAAPL,
    scanner: scanner.status === 200 && scannerFiltered > 10,
  };

  const overall = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';

  console.log('SYSTEM AUDIT REPORT (Readable)');
  console.log('================================');

  console.log('\nDatabase Volume');
  console.log(`- symbols: ${m.symbolCount}`);
  console.log(`- daily_ohlc rows: ${m.dailyRows}`);
  console.log(`- intraday_1m rows: ${m.intradayRows}`);
  console.log(`- earnings_events rows: ${m.earningsRows}`);
  console.log(`- news_events rows: ${m.newsRows}`);
  console.log(`- recent news (20d): ${m.news20d}`);

  console.log('\nIntegrity');
  console.log(`- duplicates daily_ohlc(symbol,date): ${m.dupDaily}`);
  console.log(`- duplicates intraday_1m(symbol,timestamp): ${m.dupIntraday}`);
  console.log(`- duplicates earnings_events(symbol,report_date): ${m.dupEarnings}`);
  console.log(`- duplicates news_events(symbol,published_at,headline): ${m.dupNews}`);
  console.log(`- old news >60d rows: ${m.newsOld60d}`);

  console.log('\nAPI Checks');
  console.log(`- chart 1D: status=${cDaily.status}, candles=${candles1d}`);
  console.log(`- chart 1m: status=${c1m.status}, candles=${candles1m}`);
  console.log(`- events: status=${events.status}, earnings=${earningsN}`);
  console.log(`- news: status=${news.status}, items=${newsN}`);
  console.log(`- search: status=${search.status}, hasAAPL=${searchHasAAPL}`);
  console.log(`- scanner: status=${scanner.status}, matched=${scannerFiltered}`);

  console.log('\nPass/Fail');
  for (const [k, v] of Object.entries(checks)) {
    console.log(`- ${k}: ${v ? 'PASS' : 'FAIL'}`);
  }

  console.log(`\nOverall System Status: ${overall}`);

  await pg.end();
  process.exit(overall === 'PASS' ? 0 : 1);
})();
