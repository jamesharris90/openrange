const fs = require('fs');
const path = require('path');
const { queryWithTimeout } = require('../db/pg');

function logStatus(key, ok) {
  console.log(`${key}: ${ok ? 'OK' : 'FAIL'}`);
}

async function main() {
  const engineFile = path.resolve(__dirname, '../engines/opportunityIntelligenceEngine.js');
  const startEnginesFile = path.resolve(__dirname, './startEngines.js');
  const indexFile = path.resolve(__dirname, '..', 'index.js');

  const engineExists = fs.existsSync(engineFile);
  const startEnginesContent = fs.existsSync(startEnginesFile) ? fs.readFileSync(startEnginesFile, 'utf8') : '';
  const indexContent = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';

  const schedulerRegistered =
    startEnginesContent.includes('runOpportunityIntelligenceEngine')
    && startEnginesContent.includes('global.intelligenceEngineStarted');

  const apiRouteActive = indexContent.includes("/api/intelligence/top");

  let tableExists = false;
  let testInsertWorks = false;

  try {
    const existsResult = await queryWithTimeout(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'opportunity_intelligence'
       ) AS exists`,
      [],
      { timeoutMs: 5000, label: 'validate_intelligence.table_exists', maxRetries: 0 }
    );

    tableExists = Boolean(existsResult.rows?.[0]?.exists);

    if (tableExists) {
      const symbol = `VAL_${Date.now()}`;
      await queryWithTimeout(
        `INSERT INTO opportunity_intelligence (symbol, score, confidence, movement_reason, trade_reason, trade_plan)
         VALUES ($1, 1, 1, 'test', 'test', 'test')`,
        [symbol],
        { timeoutMs: 5000, label: 'validate_intelligence.test_insert', maxRetries: 0 }
      );

      await queryWithTimeout(
        `DELETE FROM opportunity_intelligence WHERE symbol = $1`,
        [symbol],
        { timeoutMs: 5000, label: 'validate_intelligence.cleanup', maxRetries: 0 }
      );

      testInsertWorks = true;
    }
  } catch (_error) {
    tableExists = false;
    testInsertWorks = false;
  }

  logStatus('INTELLIGENCE_ENGINE', engineExists);
  logStatus('INTELLIGENCE_TABLE', tableExists && testInsertWorks);
  logStatus('API_ROUTE', apiRouteActive);
  logStatus('SCHEDULER', schedulerRegistered);
}

main().catch(() => {
  logStatus('INTELLIGENCE_ENGINE', false);
  logStatus('INTELLIGENCE_TABLE', false);
  logStatus('API_ROUTE', false);
  logStatus('SCHEDULER', false);
  process.exitCode = 1;
});
