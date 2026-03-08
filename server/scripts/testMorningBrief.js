const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { runMorningBrief } = require('../engines/morningBriefEngine');
const worker = require('../workers/rss_worker');
const { queryWithTimeout } = require('../db/pg');

async function run() {
  console.log('[TEST] Running Morning Brief');

  console.log('[RSS] news collected');
  if (typeof worker.ingestRSS === 'function') {
    await worker.ingestRSS();
  } else if (typeof worker.runRssWorker === 'function') {
    await worker.runRssWorker();
  }

  const metrics = await queryWithTimeout(
    'SELECT COUNT(*)::int AS c FROM market_metrics',
    [],
    { timeoutMs: 5000, label: 'scripts.testMorningBrief.market_metrics' }
  );
  const quotes = await queryWithTimeout(
    'SELECT COUNT(*)::int AS c FROM market_quotes',
    [],
    { timeoutMs: 5000, label: 'scripts.testMorningBrief.market_quotes' }
  );

  console.log('[MCP] generating narrative');
  const result = await runMorningBrief({
    testEmail: 'jamesharris4@me.com',
  });

  console.log('[DB] briefing stored', {
    id: result.id,
    signals: result.signals?.length || 0,
    market: result.market?.length || 0,
    news: result.news?.length || 0,
    marketMetricsCount: metrics.rows?.[0]?.c || 0,
    marketQuotesCount: quotes.rows?.[0]?.c || 0,
  });

  console.log('[EMAIL] sending via Resend');
  if (result.emailStatus?.sent) {
    console.log('[EMAIL] delivered', result.emailStatus);
  } else {
    console.log('[EMAIL] not delivered', result.emailStatus);
  }

  console.log('[TEST] Morning Brief completed');
}

run().catch((error) => {
  console.error('[TEST] Morning Brief failed:', error.message);
  process.exit(1);
});
