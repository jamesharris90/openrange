require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { supabaseAdmin } = require('../services/supabaseClient');

async function countExact(table, date) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('symbol', { count: 'exact', head: true })
    .eq('date', date);

  if (error) throw error;
  return count;
}

async function fetchLatestDates(table) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('date')
    .order('date', { ascending: false })
    .limit(5);

  if (error) throw error;
  return data;
}

async function fetchMaxDate(table) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? data.date : null;
}

async function main() {
  if (!supabaseAdmin) {
    throw new Error('supabaseAdmin unavailable');
  }

  const { count: universeCount, error: universeError } = await supabaseAdmin
    .from('ticker_universe')
    .select('symbol', { count: 'exact', head: true })
    .or('is_active.is.null,is_active.eq.true')
    .not('symbol', 'is', null);
  if (universeError) throw universeError;

  const tables = ['daily_ohlc', 'daily_ohlcv'];
  for (const table of tables) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('symbol', { count: 'exact', head: true });
    if (error) throw error;
    console.log(`## ${table}_count`);
    console.log(JSON.stringify([{ count }]));
    console.log(`## ${table}_max`);
    console.log(JSON.stringify([{ max_date: await fetchMaxDate(table) }]));
    console.log(`## ${table}_2026_04_10`);
    console.log(JSON.stringify([{ count: await countExact(table, '2026-04-10') }]));
    console.log(`## ${table}_latest_rows`);
    console.log(JSON.stringify(await fetchLatestDates(table)));
  }

  console.log('## ticker_universe_active_count');
  console.log(JSON.stringify([{ count: universeCount }]));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
