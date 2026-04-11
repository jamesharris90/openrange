require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { supabaseAdmin } = require('../services/supabaseClient');

async function tryColumn(column) {
  const { data, error } = await supabaseAdmin
    .from('ticker_universe')
    .select(`symbol, ${column}`)
    .limit(1);
  return { column, ok: !error, error: error?.message || null, data };
}

async function main() {
  if (!supabaseAdmin) throw new Error('supabaseAdmin unavailable');
  const results = await Promise.all([tryColumn('active'), tryColumn('is_active')]);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
