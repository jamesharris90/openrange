const fs = require('fs');
const path = require('path');

const SOURCES = {
  earnings: 'logs/fmp/earnings-calendar.raw.json',
  newsStock: 'logs/fmp/news-stock-latest.raw.json',
  newsGeneral: 'logs/fmp/news-general-latest.raw.json',
  ipos: 'logs/fmp/ipos-calendar.raw.json',
  splits: 'logs/fmp/splits-calendar.raw.json',
};

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8'));
}

function inferType(values) {
  const sample = values.find((v) => v !== null && v !== undefined && v !== '');
  if (sample === undefined) return 'unknown';
  if (typeof sample === 'number') return Number.isInteger(sample) ? 'integer' : 'float';
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return 'date-string';
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(sample)) return 'datetime-string';
    if (/^-?\d+(\.\d+)?$/.test(sample)) return 'numeric-string';
    return 'text';
  }
  if (Array.isArray(sample)) return 'array';
  if (typeof sample === 'object') return 'object';
  return typeof sample;
}

function summarize(rows) {
  const keys = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => keys.add(key)));
  const result = {};
  for (const key of Array.from(keys).sort()) {
    const values = rows.map((row) => row?.[key]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
    result[key] = {
      typeHint: inferType(values),
      nonNullCount: nonNull.length,
      sample: nonNull.slice(0, 2),
    };
  }
  return result;
}

const report = { generatedAt: new Date().toISOString(), sources: {} };

for (const [name, relPath] of Object.entries(SOURCES)) {
  const rows = readJson(relPath);
  report.sources[name] = {
    rowCount: Array.isArray(rows) ? rows.length : 0,
    fields: summarize(Array.isArray(rows) ? rows : []),
  };
}

const out = path.resolve(process.cwd(), 'logs/fmp/step2-schema-derivation.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
console.log(`wrote ${out}`);
for (const [name, block] of Object.entries(report.sources)) {
  console.log(`${name}: rows=${block.rowCount} fields=${Object.keys(block.fields).length}`);
}
