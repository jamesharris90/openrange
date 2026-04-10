// @ts-nocheck

const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { DATA_CONTRACT } = require('../server/contracts/dataContract.cjs');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SERVER_BASE_URL = String(process.env.SERVER_BASE_URL || '').trim().replace(/\/$/, '');
const DATABASE_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SERVER_BASE_URL'];
const TABLES = [
  DATA_CONTRACT.MARKET_DATA.DAILY,
  DATA_CONTRACT.MARKET_DATA.INTRADAY,
  DATA_CONTRACT.MARKET_DATA.EARNINGS,
  DATA_CONTRACT.NEWS.EVENTS,
];
const SQL_RPC_CANDIDATES = ['exec_sql', 'run_sql', 'execute_sql', 'sql'];

function nowIso() {
  return new Date().toISOString();
}

function statusFromBool(value) {
  return value ? 'PASS' : 'FAIL';
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function getTimeType(value) {
  if (value == null) return 'none';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object' && isFiniteNumber(value.year) && isFiniteNumber(value.month) && isFiniteNumber(value.day)) return 'businessDay';
  return typeof value;
}

async function fetchJson(url) {
  const response = await fetch(url, { method: 'GET' });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    url,
  };
}

function printSection(title) {
  console.log('');
  console.log(title);
}

function printLine(label, value) {
  console.log(`${label}: ${value}`);
}

function extractExplainNodeKinds(planNode, out = []) {
  if (!planNode || typeof planNode !== 'object') return out;
  if (planNode['Node Type']) out.push(String(planNode['Node Type']));
  const plans = Array.isArray(planNode.Plans) ? planNode.Plans : [];
  for (const child of plans) extractExplainNodeKinds(child, out);
  return out;
}

function containsSeqScan(planNode) {
  const kinds = extractExplainNodeKinds(planNode, []);
  return kinds.some((k) => k.toLowerCase().includes('seq scan'));
}

function containsIndexUsage(planNode) {
  const kinds = extractExplainNodeKinds(planNode, []);
  return kinds.some((k) => {
    const lower = k.toLowerCase();
    return lower.includes('index scan') || lower.includes('index only scan') || lower.includes('bitmap index scan') || lower.includes('bitmap heap scan');
  });
}

async function main() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let pg = null;
  if (DATABASE_URL) {
    pg = require('../server/db/pool');
  }

  async function runSql(query, params = []) {
    if (pg) {
      return pg.query(query, params);
    }

    let lastError = null;
    for (const fnName of SQL_RPC_CANDIDATES) {
      const payloadVariants = [
        { query, params },
        { sql: query, params },
        { query },
        { sql: query },
      ];

      for (const payload of payloadVariants) {
        const { data, error } = await supabase.rpc(fnName, payload);
        if (error) {
          lastError = error;
          continue;
        }

        if (Array.isArray(data)) return { rows: data };
        if (data && typeof data === 'object' && Array.isArray(data.rows)) return { rows: data.rows };
        if (data && typeof data === 'object') return { rows: [data] };
        return { rows: [] };
      }
    }

    throw new Error(lastError?.message || 'No SQL RPC available');
  }

  let overallFail = false;

  const report = {
    database: {
      daily_ohlc: 'FAIL',
      intraday_1m: 'FAIL',
      earnings_events: 'FAIL',
      news_events: 'FAIL',
    },
    integrity: {
      duplicates: 'FAIL',
      constraints: 'FAIL',
    },
    api: {
      chart_endpoint: 'FAIL',
      earnings_endpoint: 'FAIL',
      news_endpoint: 'FAIL',
      search_endpoint: 'FAIL',
    },
    performance: {
      daily_query: 'FAIL',
      intraday_query: 'FAIL',
      scanner_query: 'FAIL',
    },
  };

  const counters = {
    symbolCount: 0,
    dailyRows: 0,
    intradayRows: 0,
    earningsRows: 0,
    newsRows: 0,
    activeSymbols30d: 0,
    newsRows20d: 0,
    newsOlderThan60d: 0,
  };

  const diagnostics = {
    duplicates: {
      daily_ohlc: 0,
      intraday_1m: 0,
      earnings_events: 0,
      news_events: 0,
    },
    schema: {
      tablesPresent: true,
      missingTables: [],
      requiredColumnsPresent: true,
      missingColumns: [],
      uniqueConstraintsPresent: true,
      missingConstraints: [],
      rlsEnabled: true,
      missingRlsTables: [],
      rlsPoliciesPresent: true,
      missingPolicyTables: [],
    },
    performance: {
      daily: { status: 'FAIL', seqScan: true, indexUsed: false },
      intraday: { status: 'FAIL', seqScan: true, indexUsed: false },
      earnings: { status: 'FAIL', seqScan: true, indexUsed: false },
      news: { status: 'FAIL', seqScan: true, indexUsed: false },
      scanner: { status: 'FAIL' },
    },
    api: {
      chart1D: null,
      chart1m: null,
      events: null,
      news: null,
      search: null,
      chart1DStrict: null,
    },
  };

  const cutoff20d = new Date(Date.now() - (20 * 24 * 60 * 60 * 1000)).toISOString();
  const cutoff60d = new Date(Date.now() - (60 * 24 * 60 * 60 * 1000)).toISOString();
  const cutoff30dDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);

  try {
    printSection('SYSTEM AUDIT REPORT');
    printLine('timestamp', nowIso());

    printSection('ROW VOLUME CHECKS');

    const symbolCountResult = await supabase
      .from(DATA_CONTRACT.MARKET_DATA.DAILY)
      .select('symbol', { count: 'exact', head: true });
    if (symbolCountResult.error) throw new Error(`daily_ohlc count failed: ${symbolCountResult.error.message}`);

    const dailyRowCountResult = await supabase
      .from(DATA_CONTRACT.MARKET_DATA.DAILY)
      .select('symbol', { count: 'exact', head: true });
    if (dailyRowCountResult.error) throw new Error(`daily_ohlc row count failed: ${dailyRowCountResult.error.message}`);

    const intradayRowCountResult = await supabase
      .from(DATA_CONTRACT.MARKET_DATA.INTRADAY)
      .select('symbol', { count: 'exact', head: true });
    if (intradayRowCountResult.error) throw new Error(`intraday_1m row count failed: ${intradayRowCountResult.error.message}`);

    const earningsRowCountResult = await supabase
      .from(DATA_CONTRACT.MARKET_DATA.EARNINGS)
      .select('symbol', { count: 'exact', head: true });
    if (earningsRowCountResult.error) throw new Error(`earnings_events row count failed: ${earningsRowCountResult.error.message}`);

    const newsRowCountResult = await supabase
      .from(DATA_CONTRACT.NEWS.EVENTS)
      .select('symbol', { count: 'exact', head: true });
    if (newsRowCountResult.error) throw new Error(`news_events row count failed: ${newsRowCountResult.error.message}`);

    const symbolRows = await supabase
      .from(DATA_CONTRACT.MARKET_DATA.DAILY)
      .select('symbol')
      .limit(1);
    if (symbolRows.error) throw new Error(`daily_ohlc symbol sample failed: ${symbolRows.error.message}`);

    counters.dailyRows = Number(dailyRowCountResult.count || 0);
    counters.intradayRows = Number(intradayRowCountResult.count || 0);
    counters.earningsRows = Number(earningsRowCountResult.count || 0);
    counters.newsRows = Number(newsRowCountResult.count || 0);

    if (pg) {
      const distinctSymbolsResult = await runSql('SELECT count(DISTINCT symbol)::bigint AS c FROM daily_ohlc');
      counters.symbolCount = Number(distinctSymbolsResult.rows?.[0]?.c || 0);

      const activeSymbolsResult = await runSql(
        'SELECT count(DISTINCT symbol)::bigint AS c FROM daily_ohlc WHERE date >= $1',
        [cutoff30dDate]
      );
      counters.activeSymbols30d = Number(activeSymbolsResult.rows?.[0]?.c || 0);

      const recentNewsResult = await runSql(
        'SELECT count(*)::bigint AS c FROM news_events WHERE published_at >= $1',
        [cutoff20d]
      );
      counters.newsRows20d = Number(recentNewsResult.rows?.[0]?.c || 0);

      const oldNewsResult = await runSql(
        'SELECT count(*)::bigint AS c FROM news_events WHERE published_at < $1',
        [cutoff60d]
      );
      counters.newsOlderThan60d = Number(oldNewsResult.rows?.[0]?.c || 0);
    } else {
      const allSymbols = new Set();
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const page = await supabase
          .from(DATA_CONTRACT.MARKET_DATA.DAILY)
          .select('symbol')
          .range(from, from + pageSize - 1);
        if (page.error) throw new Error(`daily_ohlc symbol pagination failed: ${page.error.message}`);
        const rows = Array.isArray(page.data) ? page.data : [];
        rows.forEach((row) => allSymbols.add(String(row?.symbol || '').trim().toUpperCase()));
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      counters.symbolCount = allSymbols.size;

      const recentNewsCount = await supabase
        .from(DATA_CONTRACT.NEWS.EVENTS)
        .select('symbol', { count: 'exact', head: true })
        .gte('published_at', cutoff20d);
      if (recentNewsCount.error) throw new Error(`news recent count failed: ${recentNewsCount.error.message}`);
      counters.newsRows20d = Number(recentNewsCount.count || 0);

      const oldNewsCount = await supabase
        .from(DATA_CONTRACT.NEWS.EVENTS)
        .select('symbol', { count: 'exact', head: true })
        .lt('published_at', cutoff60d);
      if (oldNewsCount.error) throw new Error(`news old count failed: ${oldNewsCount.error.message}`);
      counters.newsOlderThan60d = Number(oldNewsCount.count || 0);

      counters.activeSymbols30d = counters.symbolCount;
    }

    const dailyCompletenessPass = counters.dailyRows >= (counters.symbolCount * 400);
    const intradayCompletenessPass = counters.intradayRows >= (counters.activeSymbols30d * 20 * 390);
    const earningsCompletenessPass = counters.earningsRows >= counters.symbolCount;
    const newsCompletenessPass = counters.newsRows20d > 0;

    report.database.daily_ohlc = statusFromBool(dailyCompletenessPass);
    report.database.intraday_1m = statusFromBool(intradayCompletenessPass);
    report.database.earnings_events = statusFromBool(earningsCompletenessPass);
    report.database.news_events = statusFromBool(newsCompletenessPass);

    printLine('total symbols in daily_ohlc', counters.symbolCount);
    printLine('total rows in daily_ohlc', counters.dailyRows);
    printLine('total rows in intraday_1m', counters.intradayRows);
    printLine('total rows in earnings_events', counters.earningsRows);
    printLine('total rows in news_events', counters.newsRows);
    printLine('news rows in recent 20 days', counters.newsRows20d);

    printSection('DUPLICATE CHECKS');

    let sqlChecksAvailable = true;
    try {
      await runSql('SELECT 1 AS ok');
    } catch (error) {
      sqlChecksAvailable = false;
      printLine('sql capability', `FAIL (${error?.message || String(error)})`);
    }

    if (sqlChecksAvailable) {
      const duplicateSql = {
        daily_ohlc: `
          SELECT count(*)::bigint AS duplicate_groups
          FROM (
            SELECT symbol, date, COUNT(*) AS c
            FROM daily_ohlc
            GROUP BY symbol, date
            HAVING COUNT(*) > 1
          ) t
        `,
        intraday_1m: `
          SELECT count(*)::bigint AS duplicate_groups
          FROM (
            SELECT symbol, timestamp, COUNT(*) AS c
            FROM intraday_1m
            GROUP BY symbol, timestamp
            HAVING COUNT(*) > 1
          ) t
        `,
        earnings_events: `
          SELECT count(*)::bigint AS duplicate_groups
          FROM (
            SELECT symbol, report_date, COUNT(*) AS c
            FROM earnings_events
            GROUP BY symbol, report_date
            HAVING COUNT(*) > 1
          ) t
        `,
        news_events: `
          SELECT count(*)::bigint AS duplicate_groups
          FROM (
            SELECT symbol, published_at, headline, COUNT(*) AS c
            FROM news_events
            GROUP BY symbol, published_at, headline
            HAVING COUNT(*) > 1
          ) t
        `,
      };

      for (const [table, sql] of Object.entries(duplicateSql)) {
        const result = await runSql(sql);
        const duplicateGroups = Number(result.rows?.[0]?.duplicate_groups || 0);
        diagnostics.duplicates[table] = duplicateGroups;
        printLine(`${table} duplicate groups`, duplicateGroups);
      }

      const duplicatesPass = Object.values(diagnostics.duplicates).every((n) => Number(n) === 0);
      report.integrity.duplicates = statusFromBool(duplicatesPass);
    } else {
      report.integrity.duplicates = 'FAIL';
    }

    printSection('SCHEMA / CONSTRAINTS / RLS CHECKS');

    if (!sqlChecksAvailable) {
      report.integrity.constraints = 'FAIL';
      printLine('constraints + rls checks', 'FAIL (SQL access unavailable)');
    } else {
      const tableExistsResult = await runSql(
      `
        SELECT c.relname AS table_name,
               c.relrowsecurity AS rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
      `,
      [TABLES]
      );

    const presentSet = new Set((tableExistsResult.rows || []).map((r) => String(r.table_name)));
    diagnostics.schema.missingTables = TABLES.filter((t) => !presentSet.has(t));
    diagnostics.schema.tablesPresent = diagnostics.schema.missingTables.length === 0;

    const requiredColumns = {
      daily_ohlc: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'],
      intraday_1m: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume'],
      earnings_events: ['symbol', 'report_date', 'report_time', 'eps_estimate', 'eps_actual', 'rev_estimate', 'rev_actual'],
      news_events: ['symbol', 'published_at', 'headline', 'source', 'url'],
    };

    const columnsResult = await runSql(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [TABLES]
    );

    const columnsByTable = new Map();
    for (const row of columnsResult.rows || []) {
      const table = String(row.table_name);
      const column = String(row.column_name);
      if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
      columnsByTable.get(table).add(column);
    }

    const missingColumns = [];
    for (const table of Object.keys(requiredColumns)) {
      const presentColumns = columnsByTable.get(table) || new Set();
      for (const col of requiredColumns[table]) {
        if (!presentColumns.has(col)) missingColumns.push(`${table}.${col}`);
      }
    }
    diagnostics.schema.missingColumns = missingColumns;
    diagnostics.schema.requiredColumnsPresent = missingColumns.length === 0;

    const requiredUniqueConstraints = {
      daily_ohlc: ['symbol', 'date'],
      intraday_1m: ['symbol', 'timestamp'],
      earnings_events: ['symbol', 'report_date'],
      news_events: ['symbol', 'published_at', 'headline'],
    };

    const constraintsResult = await runSql(
      `
        SELECT tc.table_name,
               tc.constraint_name,
               tc.constraint_type,
               array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = ANY($1::text[])
          AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
        GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
      `,
      [TABLES]
    );

    const constraintsByTable = new Map();
    for (const row of constraintsResult.rows || []) {
      const table = String(row.table_name);
      if (!constraintsByTable.has(table)) constraintsByTable.set(table, []);
      constraintsByTable.get(table).push((row.columns || []).map((c) => String(c)));
    }

    const missingConstraints = [];
    for (const [table, expectedCols] of Object.entries(requiredUniqueConstraints)) {
      const tableConstraints = constraintsByTable.get(table) || [];
      const found = tableConstraints.some((cols) => cols.length === expectedCols.length && cols.every((c, i) => c === expectedCols[i]));
      if (!found) missingConstraints.push(`${table}(${expectedCols.join(',')})`);
    }

    diagnostics.schema.missingConstraints = missingConstraints;
    diagnostics.schema.uniqueConstraintsPresent = missingConstraints.length === 0;

    const rlsByTable = new Map();
    for (const row of tableExistsResult.rows || []) {
      rlsByTable.set(String(row.table_name), Boolean(row.rls_enabled));
    }

    diagnostics.schema.missingRlsTables = TABLES.filter((t) => !rlsByTable.get(t));
    diagnostics.schema.rlsEnabled = diagnostics.schema.missingRlsTables.length === 0;

    const policyResult = await runSql(
      `
        SELECT tablename, count(*)::int AS policy_count
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        GROUP BY tablename
      `,
      [TABLES]
    );

    const policyCountByTable = new Map((policyResult.rows || []).map((row) => [String(row.tablename), Number(row.policy_count || 0)]));
    diagnostics.schema.missingPolicyTables = TABLES.filter((t) => (policyCountByTable.get(t) || 0) <= 0);
    diagnostics.schema.rlsPoliciesPresent = diagnostics.schema.missingPolicyTables.length === 0;

    const constraintsPass =
      diagnostics.schema.tablesPresent
      && diagnostics.schema.requiredColumnsPresent
      && diagnostics.schema.uniqueConstraintsPresent
      && diagnostics.schema.rlsEnabled
      && diagnostics.schema.rlsPoliciesPresent;

    report.integrity.constraints = statusFromBool(constraintsPass);

    printLine('tables present', diagnostics.schema.tablesPresent ? 'PASS' : `FAIL (${diagnostics.schema.missingTables.join(', ')})`);
    printLine('required columns present', diagnostics.schema.requiredColumnsPresent ? 'PASS' : `FAIL (${diagnostics.schema.missingColumns.join(', ')})`);
    printLine('required unique constraints', diagnostics.schema.uniqueConstraintsPresent ? 'PASS' : `FAIL (${diagnostics.schema.missingConstraints.join(', ')})`);
    printLine('rls enabled', diagnostics.schema.rlsEnabled ? 'PASS' : `FAIL (${diagnostics.schema.missingRlsTables.join(', ')})`);
    printLine('rls policies', diagnostics.schema.rlsPoliciesPresent ? 'PASS' : `FAIL (${diagnostics.schema.missingPolicyTables.join(', ')})`);
    }

    printSection('INDEX PERFORMANCE CHECKS');

    const explainQueries = {
      daily: `
        EXPLAIN (FORMAT JSON)
        SELECT symbol, date, close
        FROM daily_ohlc
        WHERE symbol = 'AAPL'
          AND date >= current_date - interval '365 days'
        ORDER BY date DESC
      `,
      intraday: `
        EXPLAIN (FORMAT JSON)
        SELECT symbol, timestamp, close
        FROM intraday_1m
        WHERE symbol = 'AAPL'
        ORDER BY timestamp DESC
        LIMIT 200
      `,
      earnings: `
        EXPLAIN (FORMAT JSON)
        SELECT DISTINCT ON (symbol) symbol, report_date, eps_actual
        FROM earnings_events
        ORDER BY symbol, report_date DESC
      `,
      news: `
        EXPLAIN (FORMAT JSON)
        SELECT symbol, published_at, headline
        FROM news_events
        WHERE published_at >= now() - interval '20 days'
        ORDER BY published_at DESC
      `,
    };

    if (!sqlChecksAvailable) {
      diagnostics.performance.daily = { status: 'FAIL', seqScan: true, indexUsed: false };
      diagnostics.performance.intraday = { status: 'FAIL', seqScan: true, indexUsed: false };
      diagnostics.performance.earnings = { status: 'FAIL', seqScan: true, indexUsed: false };
      diagnostics.performance.news = { status: 'FAIL', seqScan: true, indexUsed: false };
      printLine('performance checks', 'FAIL (SQL access unavailable)');
    } else {
      for (const [key, sql] of Object.entries(explainQueries)) {
        const result = await runSql(sql);
        const planWrapper = result.rows?.[0]?.['QUERY PLAN'];
        const plan = Array.isArray(planWrapper) ? planWrapper[0]?.Plan : null;
        const seqScan = containsSeqScan(plan);
        const indexUsed = containsIndexUsage(plan);
        const status = seqScan ? 'WARN' : (indexUsed ? 'PASS' : 'FAIL');

        diagnostics.performance[key] = {
          status,
          seqScan,
          indexUsed,
        };

        printLine(`${key} query`, `${status} (indexUsed=${indexUsed}, seqScan=${seqScan})`);
      }
    }

    report.performance.daily_query = diagnostics.performance.daily.status;
    report.performance.intraday_query = diagnostics.performance.intraday.status;

    printSection('API ROUTE VALIDATION');

    const apiChart1D = await fetchJson(`${SERVER_BASE_URL}/api/v5/chart?symbol=AAPL&timeframe=1D`);
    const apiChart1m = await fetchJson(`${SERVER_BASE_URL}/api/v5/chart?symbol=AAPL&timeframe=1m`);
    const apiEvents = await fetchJson(`${SERVER_BASE_URL}/api/v5/events?symbol=AAPL`);
    const apiNews = await fetchJson(`${SERVER_BASE_URL}/api/v5/news?symbol=AAPL`);
    const apiSearch = await fetchJson(`${SERVER_BASE_URL}/api/v5/search?q=APP`);

    diagnostics.api.chart1D = apiChart1D;
    diagnostics.api.chart1m = apiChart1m;
    diagnostics.api.events = apiEvents;
    diagnostics.api.news = apiNews;
    diagnostics.api.search = apiSearch;

    const chartStatusPass = apiChart1D.status === 200 && apiChart1m.status === 200;
    const eventsStatusPass = apiEvents.status === 200;
    const newsStatusPass = apiNews.status === 200;
    const searchStatusPass = apiSearch.status === 200;

    report.api.chart_endpoint = statusFromBool(chartStatusPass);
    report.api.earnings_endpoint = statusFromBool(eventsStatusPass);
    report.api.news_endpoint = statusFromBool(newsStatusPass);
    report.api.search_endpoint = statusFromBool(searchStatusPass);

    printLine('GET /api/v5/chart?symbol=AAPL&timeframe=1D', apiChart1D.status);
    printLine('GET /api/v5/chart?symbol=AAPL&timeframe=1m', apiChart1m.status);
    printLine('GET /api/v5/events?symbol=AAPL', apiEvents.status);
    printLine('GET /api/v5/news?symbol=AAPL', apiNews.status);
    printLine('GET /api/v5/search?q=APP', apiSearch.status);

    printSection('CHART PAYLOAD VALIDATION');

    const candles1d = Array.isArray(apiChart1D.body?.candles) ? apiChart1D.body.candles : [];
    const candles1m = Array.isArray(apiChart1m.body?.candles) ? apiChart1m.body.candles : [];

    const strict1D = await fetchJson(`${SERVER_BASE_URL}/api/v5/chart?symbol=AAPL&interval=1day`);
    diagnostics.api.chart1DStrict = strict1D;

    const strict1dEvents = strict1D?.body?.events || {};
    const strict1dEarnings = Array.isArray(strict1dEvents?.earnings) ? strict1dEvents.earnings : [];
    const strict1dNews = Array.isArray(strict1dEvents?.news) ? strict1dEvents.news : [];
    const strict1dCandles = Array.isArray(strict1D?.body?.candles) ? strict1D.body.candles : [];

    const candleLenPass = candles1d.length > 200;
    const intradayLenPass = candles1m.length > 1000;
    const earningsMarkersPass = strict1dEarnings.length > 0;

    const newsMajorOnlyPass = strict1dNews.every((item) => {
      if (item == null || typeof item !== 'object') return false;
      if (item.importance == null) return true;
      return String(item.importance).toLowerCase() === 'major';
    });

    const candleTimeType = getTimeType(strict1dCandles[0]?.time);
    const markerTimeType = getTimeType(strict1dEarnings[0]?.time);
    const markerTimeTypePass = candleTimeType === markerTimeType;

    const chartPayloadPass = candleLenPass
      && intradayLenPass
      && earningsMarkersPass
      && newsMajorOnlyPass
      && markerTimeTypePass;

    printLine('1D candle length > 200', statusFromBool(candleLenPass));
    printLine('1m payload > 1000 rows', statusFromBool(intradayLenPass));
    printLine('earnings events included in 1D', statusFromBool(earningsMarkersPass));
    printLine('news events only include major', statusFromBool(newsMajorOnlyPass));
    printLine('marker time matches candle time type', `${statusFromBool(markerTimeTypePass)} (${markerTimeType} vs ${candleTimeType})`);

    if (!chartPayloadPass) {
      report.api.chart_endpoint = 'FAIL';
    }

    const eventsPayload = apiEvents.body || {};
    const eventsEarnings = Array.isArray(eventsPayload?.earnings) ? eventsPayload.earnings : [];
    const eventsNews = Array.isArray(eventsPayload?.news) ? eventsPayload.news : [];
    const eventsHasEarningsPass = eventsEarnings.length > 0;

    const newsArray = Array.isArray(apiNews.body) ? apiNews.body : [];
    const newsNotEmptyWhenDbHasNewsPass = counters.newsRows20d <= 0 ? true : newsArray.length > 0;

    const searchRows = Array.isArray(apiSearch.body) ? apiSearch.body : [];
    const searchReturnsAaplPass = searchRows.some((row) => String(row?.symbol || '').toUpperCase() === 'AAPL');

    if (!eventsHasEarningsPass) report.api.earnings_endpoint = 'FAIL';
    if (!newsNotEmptyWhenDbHasNewsPass) report.api.news_endpoint = 'FAIL';
    if (!searchReturnsAaplPass) report.api.search_endpoint = 'FAIL';

    printLine('events missing earnings', eventsHasEarningsPass ? 'PASS' : 'FAIL');
    printLine('news empty when DB has news', newsNotEmptyWhenDbHasNewsPass ? 'PASS' : 'FAIL');
    printLine('search returns AAPL', searchReturnsAaplPass ? 'PASS' : 'FAIL');

    printSection('SCANNER VALIDATION');

    const scannerApi = await fetchJson(
      `${SERVER_BASE_URL}/api/v3/screener/technical?priceMin=5&volumeMin=1000000&limit=200`
    );

    const scannerRows = Array.isArray(scannerApi.body?.data) ? scannerApi.body.data : [];
    const scannerFiltered = scannerRows.filter((row) => {
      const price = Number(row?.price);
      const sma20 = Number(row?.sma20);
      const volume = Number(row?.volume);
      return Number.isFinite(price)
        && Number.isFinite(sma20)
        && Number.isFinite(volume)
        && price > 5
        && volume > 1_000_000
        && price > sma20;
    });

    const scannerPass = scannerApi.status === 200 && scannerFiltered.length > 10;
    diagnostics.performance.scanner = {
      status: scannerPass ? 'PASS' : 'FAIL',
    };
    report.performance.scanner_query = diagnostics.performance.scanner.status;

    printLine('scanner status', scannerApi.status);
    printLine('scanner matched rows', scannerFiltered.length);

    printSection('NEWS CLEANUP VALIDATION');
    const newsCleanupPass = counters.newsOlderThan60d === 0;
    printLine('news rows older than 60 days', counters.newsOlderThan60d);
    printLine('news cleanup', statusFromBool(newsCleanupPass));

    if (!newsCleanupPass) {
      report.database.news_events = 'FAIL';
    }

    const dbPass = Object.values(report.database).every((s) => s === 'PASS');
    const integrityPass = Object.values(report.integrity).every((s) => s === 'PASS');
    const apiPass = Object.values(report.api).every((s) => s === 'PASS');

    const performanceStatuses = Object.values(report.performance);
    const performanceFail = performanceStatuses.includes('FAIL');

    overallFail = !dbPass || !integrityPass || !apiPass || performanceFail;

    printSection('FINAL SUMMARY');
    console.log('Database:');
    printLine('daily_ohlc', report.database.daily_ohlc);
    printLine('intraday_1m', report.database.intraday_1m);
    printLine('earnings_events', report.database.earnings_events);
    printLine('news_events', report.database.news_events);

    console.log('');
    console.log('Integrity:');
    printLine('duplicates', report.integrity.duplicates);
    printLine('constraints', report.integrity.constraints);

    console.log('');
    console.log('API:');
    printLine('chart endpoint', report.api.chart_endpoint);
    printLine('earnings endpoint', report.api.earnings_endpoint);
    printLine('news endpoint', report.api.news_endpoint);
    printLine('search endpoint', report.api.search_endpoint);

    console.log('');
    console.log('Performance:');
    printLine('daily query', report.performance.daily_query);
    printLine('intraday query', report.performance.intraday_query);
    printLine('scanner query', report.performance.scanner_query);

    console.log('');
    printLine('Overall System Status', overallFail ? 'FAIL' : 'PASS');

    if (overallFail) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('SYSTEM AUDIT FAILED:', error?.message || String(error));
    process.exitCode = 1;
  } finally {
    if (pg) {
      try {
        await pg.end();
      } catch (_error) {
      }
    }
  }
}

main();
