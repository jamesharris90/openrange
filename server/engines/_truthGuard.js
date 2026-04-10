const fs = require('fs');
const path = require('path');

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required truth file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function setFromColumns(tablePayload) {
  return new Set((tablePayload?.columns || []).map((c) => c.column));
}

function validateTableAndColumns(schemaTruth, tableName, requiredColumns) {
  const table = schemaTruth?.tables?.[tableName];
  if (!table) {
    throw new Error(`Schema truth missing required table: ${tableName}`);
  }

  const cols = setFromColumns(table);
  const missing = (requiredColumns || []).filter((c) => !cols.has(c));
  if (missing.length > 0) {
    throw new Error(`Schema mismatch for ${tableName}; missing columns: ${missing.join(', ')}`);
  }
}

function validateMappingCoverage(mappingTruth, requiredEndpoints) {
  const mappings = mappingTruth?.mappings || {};
  for (const endpoint of requiredEndpoints || []) {
    if (!mappings[endpoint]) {
      throw new Error(`Mapping truth missing required endpoint: ${endpoint}`);
    }

    const map = mappings[endpoint];
    if (!map.target_table || !map.field_map || typeof map.field_map !== 'object') {
      throw new Error(`Mapping truth invalid contract for endpoint: ${endpoint}`);
    }
  }
}

function loadAndValidateTruth(options = {}) {
  const root = path.resolve(__dirname, '../..');
  const dbTruthPath = path.resolve(root, 'logs/db_schema_truth.json');
  const fmpMappingPath = path.resolve(root, 'logs/fmp_field_mapping.json');

  const schemaTruth = loadJson(dbTruthPath);
  const mappingTruth = loadJson(fmpMappingPath);

  const requiredTables = options.requiredTables || {};
  for (const [table, columns] of Object.entries(requiredTables)) {
    validateTableAndColumns(schemaTruth, table, columns);
  }

  validateMappingCoverage(mappingTruth, options.requiredMappings || []);

  return {
    schemaTruth,
    mappingTruth,
    dbTruthPath,
    fmpMappingPath,
  };
}

module.exports = {
  loadAndValidateTruth,
};
