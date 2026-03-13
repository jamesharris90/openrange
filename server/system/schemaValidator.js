const { queryWithTimeout } = require('../db/pg');
const { DATA_CONTRACT, CANONICAL_TABLES } = require('../config/dataContract');

const ROW_COUNT_TABLES = [
  DATA_CONTRACT.news.table,
  DATA_CONTRACT.alerts.table,
  DATA_CONTRACT.signals.table,
  DATA_CONTRACT.opportunities.table,
  DATA_CONTRACT.marketQuotes.table,
  DATA_CONTRACT.marketMetrics.table,
];

function isSafeIdentifier(value) {
  return /^[a-z_][a-z0-9_]*$/i.test(String(value || ''));
}

async function fetchSchemaColumns() {
  const result = await queryWithTimeout(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
    [],
    { timeoutMs: 4000, label: 'schema_validator.columns', maxRetries: 0 }
  );

  const map = new Map();
  for (const row of result.rows || []) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set());
    map.get(row.table_name).add(row.column_name);
  }
  return map;
}

async function fetchPublicTables() {
  const result = await queryWithTimeout(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    [],
    { timeoutMs: 4000, label: 'schema_validator.tables', maxRetries: 0 }
  );

  return new Set((result.rows || []).map((row) => row.table_name));
}

async function getTableRowCount(tableName) {
  if (!isSafeIdentifier(tableName)) return 0;

  const existsResult = await queryWithTimeout(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${tableName}`],
    { timeoutMs: 2500, label: `schema_validator.exists.${tableName}`, maxRetries: 0 }
  );

  if (!existsResult.rows?.[0]?.exists) return 0;

  const countResult = await queryWithTimeout(
    `SELECT COUNT(*)::int AS count FROM ${tableName}`,
    [],
    { timeoutMs: 3000, label: `schema_validator.count.${tableName}`, maxRetries: 0 }
  );

  return Number(countResult.rows?.[0]?.count || 0);
}

async function getSchemaHealthSnapshot() {
  const [schemaColumns, publicTables] = await Promise.all([
    fetchSchemaColumns(),
    fetchPublicTables(),
  ]);

  const contractEntries = Object.values(DATA_CONTRACT);
  const expectedTables = new Set(contractEntries.map((entry) => entry.table));

  const missingTables = [];
  const missingColumns = {};
  const unexpectedColumns = {};

  for (const entry of contractEntries) {
    const tableName = entry.table;
    const expectedColumns = new Set(entry.columns || []);
    const actualColumns = schemaColumns.get(tableName);

    if (!actualColumns) {
      missingTables.push(tableName);
      continue;
    }

    const missing = [...expectedColumns].filter((column) => !actualColumns.has(column));
    const unexpected = [...actualColumns].filter((column) => !expectedColumns.has(column));

    if (missing.length > 0) {
      missingColumns[tableName] = missing;
    }

    if (unexpected.length > 0) {
      unexpectedColumns[tableName] = unexpected;
    }
  }

  const expectedFromContract = new Set(CANONICAL_TABLES);
  const unexpectedTables = [...publicTables].filter((tableName) => !expectedFromContract.has(tableName));

  const hasDrift =
    missingTables.length > 0
    || Object.keys(missingColumns).length > 0
    || Object.keys(unexpectedColumns).length > 0;

  if (hasDrift) {
    console.warn('[SCHEMA DRIFT DETECTED]', {
      missingTables,
      missingColumns,
      unexpectedColumns,
    });
  }

  const rowCounts = {};
  for (const tableName of ROW_COUNT_TABLES) {
    rowCounts[tableName] = await getTableRowCount(tableName);
  }

  return {
    schemaStatus: hasDrift ? 'drift' : 'ok',
    missingTables,
    missingColumns,
    unexpectedColumns,
    unexpectedTables,
    rowCounts,
  };
}

async function validateSchema() {
  try {
    const snapshot = await getSchemaHealthSnapshot();
    return snapshot.schemaStatus === 'ok';
  } catch (error) {
    console.error('[SCHEMA VALIDATOR ERROR]', error.message);
    return false;
  }
}

module.exports = {
  validateSchema,
  getSchemaHealthSnapshot,
};
