#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const stableValidationPath = path.resolve(__dirname, '../logs/fmp_stable_validation.json');
const schemaTruthPath = path.resolve(__dirname, '../logs/db_schema_truth.json');

const stableValidation = JSON.parse(fs.readFileSync(stableValidationPath, 'utf8'));
const schemaTruth = JSON.parse(fs.readFileSync(schemaTruthPath, 'utf8'));

const intradayColumns = new Set(['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'session']);

const dbColumns = {};
for (const [table, payload] of Object.entries(schemaTruth.tables || {})) {
  dbColumns[table] = new Set((payload.columns || []).map((c) => c.column));
}
dbColumns.intraday_1m = intradayColumns;

const mappings = {
  'batch-exchange-quote': {
    target_table: 'tradable_universe',
    field_map: {
      symbol: 'symbol',
      price: 'price',
      change: 'change_percent',
      volume: 'volume'
    },
    computed_fields: {
      updated_at: 'NOW()'
    }
  },
  'batch-quote': {
    target_table: 'market_metrics',
    field_map: {
      symbol: 'symbol',
      price: 'price',
      changePercentage: 'change_percent',
      volume: 'volume',
      previousClose: 'previous_close'
    },
    computed_fields: {
      updated_at: 'NOW()'
    }
  },
  'stock-news': {
    target_table: 'news_articles',
    field_map: {
      symbol: 'symbol',
      publishedDate: 'published_at',
      title: 'title',
      text: 'body_text',
      url: 'url',
      publisher: 'publisher',
      site: 'site',
      image: 'image_url'
    },
    computed_fields: {
      created_at: 'NOW()'
    }
  },
  'earnings-calendar': {
    target_table: 'earnings_events',
    field_map: {
      symbol: 'symbol',
      date: 'report_date',
      epsActual: 'eps_actual',
      epsEstimated: 'eps_estimate',
      revenueActual: 'rev_actual',
      revenueEstimated: 'rev_estimate'
    },
    computed_fields: {
      updated_at: 'NOW()'
    }
  },
  'historical-chart-1min': {
    target_table: 'intraday_1m',
    field_map: {
      date: 'timestamp',
      open: 'open',
      high: 'high',
      low: 'low',
      close: 'close',
      volume: 'volume'
    },
    computed_fields: {
      symbol: 'request.symbol'
    }
  }
};

function getEndpointSample(endpointKey) {
  const endpoint = (stableValidation.endpoints || []).find((e) => e.endpoint === endpointKey);
  return endpoint ? endpoint.sample_row || {} : {};
}

const mappingValidation = {
  generated_at: new Date().toISOString(),
  phase: 'fmp_field_mapping_validation',
  stable_validation_pass: !!stableValidation.pass,
  mappings: {},
  mismatches: [],
  pass: true
};

for (const [endpointKey, mapDef] of Object.entries(mappings)) {
  const sourceSample = getEndpointSample(endpointKey);
  const targetCols = dbColumns[mapDef.target_table] || new Set();

  const endpointResult = {
    endpoint: endpointKey,
    target_table: mapDef.target_table,
    source_fields_checked: Object.keys(mapDef.field_map),
    target_fields_checked: Object.values(mapDef.field_map),
    missing_source_fields: [],
    missing_target_columns: [],
    pass: true
  };

  for (const sourceField of Object.keys(mapDef.field_map)) {
    if (!(sourceField in sourceSample)) {
      endpointResult.missing_source_fields.push(sourceField);
    }
  }

  for (const targetField of Object.values(mapDef.field_map)) {
    if (!targetCols.has(targetField)) {
      endpointResult.missing_target_columns.push(targetField);
    }
  }

  if (endpointResult.missing_source_fields.length || endpointResult.missing_target_columns.length) {
    endpointResult.pass = false;
    mappingValidation.pass = false;
    mappingValidation.mismatches.push({
      endpoint: endpointKey,
      missing_source_fields: endpointResult.missing_source_fields,
      missing_target_columns: endpointResult.missing_target_columns
    });
  }

  mappingValidation.mappings[endpointKey] = endpointResult;
}

fs.mkdirSync(path.resolve(__dirname, '../server/config'), { recursive: true });
fs.writeFileSync(
  path.resolve(__dirname, '../server/config/fmp_field_mapping.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), mappings }, null, 2)
);

fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
fs.writeFileSync(
  path.resolve(__dirname, '../logs/fmp_field_mapping_validation.json'),
  JSON.stringify(mappingValidation, null, 2)
);

console.log('mapping artifacts written');
if (!mappingValidation.pass) process.exit(1);
