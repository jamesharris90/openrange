const { runIngestionForUniverseNow } = require('../engines/fmpMarketIngestion');
const { runMarketNarrativeEngine } = require('../engines/marketNarrativeEngine');
const runRadarEngine = require('../engines/radarEngine');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { getDataHealth } = require('./dataHealthEngine');

function line(label, status, detail = '') {
  return `${label}: ${status}${detail ? ` (${detail})` : ''}`;
}

async function runEngineDiagnostics() {
  const results = [];

  try {
    await runIngestionForUniverseNow();
    results.push(line('INGESTION ENGINE', 'OK'));
  } catch (error) {
    results.push(line('INGESTION ENGINE', 'FAILED', error.message));
  }

  try {
    await runMarketNarrativeEngine();
    results.push(line('NARRATIVE ENGINE', 'OK'));
  } catch (error) {
    results.push(line('NARRATIVE ENGINE', 'FAILED', error.message));
  }

  try {
    await runRadarEngine();
    results.push(line('RADAR ENGINE', 'OK'));
  } catch (error) {
    results.push(line('RADAR ENGINE', 'FAILED', error.message));
  }

  try {
    await runOpportunityRanker();
    results.push(line('OPPORTUNITY ENGINE', 'OK'));
  } catch (error) {
    results.push(line('OPPORTUNITY ENGINE', 'FAILED', error.message));
  }

  const health = await getDataHealth();
  if (Number(health.tables?.earnings_events || 0) === 0) {
    results.push(line('EARNINGS ENGINE', 'WARNING', '0 rows'));
  } else {
    results.push(line('EARNINGS ENGINE', 'OK'));
  }

  return {
    lines: results,
    health,
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
    console.error(line('ENGINE DIAGNOSTICS', 'FAILED', error.message));
    process.exit(1);
  });
}

module.exports = {
  runEngineDiagnostics,
};
