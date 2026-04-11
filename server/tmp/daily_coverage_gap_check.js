require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
}
const { supabaseAdmin } = require('../services/supabaseClient');

async function fetchAll(table, select, pageSize = 1000, applyFilters = null) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabaseAdmin
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (typeof applyFilters === 'function') {
      query = applyFilters(query);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  if (!supabaseAdmin) throw new Error('supabaseAdmin unavailable');
  const universeRows = await fetchAll('ticker_universe', 'symbol,is_active');
  const activeSymbols = universeRows
    .filter((row) => row && row.is_active === true && row.symbol)
    .map((row) => String(row.symbol).trim().toUpperCase());

  const { data: latestRow, error: latestError } = await supabaseAdmin
    .from('daily_ohlc')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const latestDate = String(latestRow?.date || '');

  const latestDateRows = await fetchAll(
    'daily_ohlc',
    'symbol,date',
    1000,
    (query) => query.eq('date', latestDate)
  );
  const latestSymbols = new Set(
    latestDateRows
      .filter((row) => String(row?.date || '') === latestDate)
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean)
  );

  const missing = activeSymbols.filter((symbol) => !latestSymbols.has(symbol));
  console.log(JSON.stringify({
    latestDate,
    activeUniverse: activeSymbols.length,
    latestDateRows: latestSymbols.size,
    gap: missing.length,
    sampleMissing: missing.slice(0, 50),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
