/**
 * Isolation test for top_coiled_spring signal.
 *
 * Phase 48: signal is scaffolded but not wired in. This test verifies
 * the signal computes correctly in isolation.
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const sig = require('../signals/top_coiled_spring');
const { pool } = require('../../db/pg');
const hasDatabaseUrl = Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
const testIfDatabase = hasDatabaseUrl ? test : test.skip;

testIfDatabase('top_coiled_spring detect() smoke test', async () => {
  console.log('Testing top_coiled_spring detect()...');
  const results = await sig.detect();

  console.log(`Got ${results.size} compressed symbols`);

  if (results.size === 0) {
    throw new Error('Expected some compressed symbols, got 0');
  }

  console.log('');
  console.log('Top 10 most compressed:');
  let index = 0;
  for (const [symbol, result] of results.entries()) {
    if (index++ >= 10) break;
    console.log(`  ${result.rank}. ${symbol}: compression score ${result.score.toFixed(2)}`);
    console.log(`     atr_5d=${result.metadata.atr_5d.toFixed(3)}, atr_20d=${result.metadata.atr_20d.toFixed(3)}`);
    console.log(`     vol_5d=${Math.round(result.metadata.vol_5d).toLocaleString()}, vol_20d=${Math.round(result.metadata.vol_20d).toLocaleString()}`);
    console.log(`     reasoning: ${result.reasoning}`);
    console.log(`     summarize: ${sig.summarize(result.metadata)}`);
  }

  for (const [, result] of results.entries()) {
    if (!result.symbol) throw new Error('missing symbol');
    if (result.signal !== sig.SIGNAL_NAME) throw new Error('missing signal name');
    if (typeof result.rank !== 'number') throw new Error('rank not number');
    if (typeof result.score !== 'number') throw new Error('score not number');
    if (!result.metadata) throw new Error('missing metadata');
    if (!result.reasoning) throw new Error('missing reasoning');
    if (typeof result.metadata.atr_5d !== 'number') throw new Error('atr_5d not number');
    if (typeof result.metadata.atr_20d !== 'number') throw new Error('atr_20d not number');
    if (typeof result.metadata.vol_5d !== 'number') throw new Error('vol_5d not number');
    if (typeof result.metadata.vol_20d !== 'number') throw new Error('vol_20d not number');
  }

  console.log('');
  console.log('SMOKE TEST PASSED');
}, 30000);

afterAll(async () => {
  await pool.end().catch(() => {});
});
