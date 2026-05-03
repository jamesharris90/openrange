/**
 * Isolation test for top_volume_building signal.
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const sig = require('../signals/top_volume_building');
const { pool } = require('../../db/pg');

const hasDatabaseUrl = Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
const testIfDatabase = hasDatabaseUrl ? test : test.skip;

testIfDatabase('top_volume_building detect() smoke test', async () => {
  console.log('Testing top_volume_building detect()...');
  const results = await sig.detect();

  console.log(`Got ${results.size} symbols showing volume building`);

  if (results.size === 0) {
    console.log('WARNING: 0 results. Either no symbols match thresholds, '
      + 'or thresholds need tuning. Reporting and continuing — not necessarily '
      + 'a failure since some market conditions produce no accumulation candidates.');
  }

  console.log('');
  console.log('Top 10 volume-building symbols:');
  let i = 0;
  for (const [symbol, result] of results.entries()) {
    if (i >= 10) break;
    i += 1;
    console.log(`  ${result.rank}. ${symbol}: score ${result.score.toFixed(2)}`);
    console.log(`     vol_ratio=${result.metadata.vol_ratio}, `
      + `vol_increase=${result.metadata.vol_increase_pct}%, `
      + `price_change_5d=${result.metadata.price_change_5d_pct}%`);
    console.log(`     reasoning: ${result.reasoning}`);
    console.log(`     summarize: ${sig.summarize(result.metadata)}`);
  }

  for (const [symbol, result] of results.entries()) {
    if (!result.symbol) throw new Error(`missing symbol on ${symbol}`);
    if (!result.signal) throw new Error(`missing signal name on ${symbol}`);
    if (typeof result.rank !== 'number') throw new Error(`rank not number on ${symbol}`);
    if (typeof result.score !== 'number' || Number.isNaN(result.score)) {
      throw new Error(`score invalid on ${symbol}`);
    }
    if (!result.metadata) throw new Error(`missing metadata on ${symbol}`);
    if (typeof result.metadata.vol_increase_pct !== 'number') {
      throw new Error(`vol_increase_pct missing on ${symbol}`);
    }
    if (!result.reasoning) throw new Error(`missing reasoning on ${symbol}`);
  }

  if (sig.FORWARD_LOOKING !== true) {
    throw new Error('FORWARD_LOOKING export must be true for top_volume_building');
  }

  console.log('');
  console.log('SMOKE TEST PASSED');
}, 30000);

afterAll(async () => {
  await pool.end().catch(() => {});
});
