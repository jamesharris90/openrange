/**
 * Isolation test for top_congressional_trades_recent signal.
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const sig = require('../signals/top_congressional_trades_recent');
const { pool } = require('../../db/pg');

async function smokeTest() {
  console.log('Testing top_congressional_trades_recent detect()...');
  const results = await sig.detect();

  console.log(`Got ${results.size} symbols with congressional activity`);

  if (results.size === 0) {
    throw new Error('0 results. congressional_trades is empty or filters are too strict.');
  }

  console.log('');
  console.log('Top 10 by score:');
  let i = 0;
  for (const [symbol, result] of results.entries()) {
    if (i++ >= 10) break;
    console.log(`  ${result.rank}. ${symbol}: score ${result.score.toFixed(2)}`);
    console.log(
      `     ${result.metadata.distinct_members} members, `
      + `${result.metadata.total_purchases} purchases, `
      + `both-chambers=${result.metadata.is_both_chambers}, `
      + `high-profile=${result.metadata.is_high_profile}, `
      + `largest=$${result.metadata.largest_amount}`,
    );
    console.log(`     reasoning: ${result.reasoning}`);
    console.log(`     summarize: ${sig.summarize(result.metadata)}`);
  }

  for (const [symbol, result] of results.entries()) {
    if (!result.symbol) throw new Error(`missing symbol on ${symbol}`);
    if (!result.signal) throw new Error('missing signal name');
    if (typeof result.rank !== 'number') throw new Error(`rank not number on ${symbol}`);
    if (typeof result.score !== 'number' || Number.isNaN(result.score)) {
      throw new Error(`score invalid on ${symbol}`);
    }
    if (!result.metadata) throw new Error(`missing metadata on ${symbol}`);
    if (typeof result.metadata.distinct_members !== 'number') {
      throw new Error(`distinct_members missing on ${symbol}`);
    }
    if (!result.reasoning) throw new Error(`missing reasoning on ${symbol}`);
  }

  if (sig.FORWARD_LOOKING !== false) {
    throw new Error('FORWARD_LOOKING export must be false (signal detects backward event)');
  }

  if (!Array.isArray(sig.HIGH_PROFILE_MEMBERS) || sig.HIGH_PROFILE_MEMBERS.length === 0) {
    throw new Error('HIGH_PROFILE_MEMBERS must be exported as non-empty array');
  }

  console.log('');
  console.log('SMOKE TEST PASSED');
}

smokeTest()
  .catch((error) => {
    console.error('FAILED:', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));