const { ingestMarketQuotesRefresh, ingestMarketQuotesBootstrap } = require('../engines/fmpMarketIngestion');
const { runMarketNarrativeEngine } = require('../engines/marketNarrativeEngine');
const runRadarEngine = require('../engines/radarEngine');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { runStocksInPlayEngine } = require('../engines/stocksInPlayEngine');
const { runShortSqueezeEngine } = require('../engines/shortSqueezeEngine');
const { runFlowDetectionEngine } = require('../engines/flowDetectionEngine');
const { getDataHealth } = require('./dataHealthEngine');
const logger = require('../logger');

function line(label, status, detail = '') {
  return `${label}: ${status}${detail ? ` (${detail})` : ''}`;
}

async function runEngineDiagnostics() {
  const results = [];
  const engineStatus = {};

  const runStep = async (key, label, fn) => {
    const startedAt = Date.now();
    try {
      const output = await fn();
      const ok = output?.ok !== false && !output?.error;
      engineStatus[key] = {
        status: ok ? 'ok' : 'failed',
        errors: ok ? [] : [String(output?.error || 'Unknown failure')],
        last_run: new Date().toISOString(),
        execution_time: Date.now() - startedAt,
      };
      results.push(line(label, ok ? 'OK' : 'FAILED', ok ? '' : String(output?.error || 'Unknown failure')));
    } catch (error) {
      logger.error('[ENGINE ERROR] diagnostics step failed', { engine: key, error: error.message });
      engineStatus[key] = {
        status: 'failed',
        errors: [String(error.message || 'Unknown failure')],
        last_run: new Date().toISOString(),
        execution_time: Date.now() - startedAt,
      };
      results.push(line(label, 'FAILED', error.message));
    }
  };

  await runStep('ingestion', 'INGESTION ENGINE', async () => {
    const refreshResult = await ingestMarketQuotesRefresh();
    if (refreshResult?.error) return { ok: false, error: refreshResult.error };
    return { ok: true };
  });

  await runStep('narrative', 'NARRATIVE ENGINE', runMarketNarrativeEngine);
  await runStep('radar', 'RADAR ENGINE', runRadarEngine);
  await runStep('opportunity', 'OPPORTUNITY ENGINE', runOpportunityRanker);
  await runStep('stocks_in_play', 'STOCKS IN PLAY ENGINE', runStocksInPlayEngine);
  await runStep('short_squeeze', 'SHORT SQUEEZE ENGINE', runShortSqueezeEngine);
  await runStep('flow_detection', 'FLOW DETECTION ENGINE', runFlowDetectionEngine);
  await runStep('market_narrative', 'MARKET NARRATIVE ENGINE', runMarketNarrativeEngine);

  const health = await getDataHealth();
  if (Number(health.tables?.earnings_events || 0) === 0) {
    engineStatus.earnings = {
      status: 'warning',
      errors: ['0 rows'],
      last_run: new Date().toISOString(),
      execution_time: 0,
    };
    results.push(line('EARNINGS ENGINE', 'WARNING', '0 rows'));
  } else {
    engineStatus.earnings = {
      status: 'ok',
      errors: [],
      last_run: new Date().toISOString(),
      execution_time: 0,
    };
    results.push(line('EARNINGS ENGINE', 'OK'));
  }

  const allOk = Object.values(engineStatus).every((item) => item.status === 'ok');
  results.unshift(line('SYSTEM STATUS', allOk ? 'OK' : 'WARN'));
  results.push(line('ALL ENGINES', allOk ? 'OK' : 'WARN'));

  return {
    lines: results,
    health,
    engines: engineStatus,
    status: allOk ? 'ok' : 'warning',
    checked_at: new Date().toISOString(),
  };
}

async function runAsScript() {
  const output = await runEngineDiagnostics();
  console.log(output.lines.join('\n'));
  process.exit(0);
}

if (require.main === module) {
  runAsScript().catch((error) => {
    logger.error('[ENGINE ERROR] diagnostics script failed', { error: error.message });
    console.error(line('ENGINE DIAGNOSTICS', 'FAILED', error.message));
    process.exit(1);
  });
}

module.exports = {
  runEngineDiagnostics,
};
