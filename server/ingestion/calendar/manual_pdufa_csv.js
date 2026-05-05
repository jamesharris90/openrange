const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { makeSourceId, upsertEvents } = require('./_helpers');

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function rowsFromCsv(content) {
  const lines = String(content || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((accumulator, header, index) => {
      accumulator[header] = values[index] || '';
      return accumulator;
    }, {});
  });
}

function normalizeRow(row) {
  if (!row.symbol || !row.event_date || !row.drug_name) {
    throw new Error('symbol, event_date, and drug_name are required');
  }

  return {
    event_type: row.event_type || 'PDUFA',
    event_date: row.event_date,
    symbol: String(row.symbol).trim().toUpperCase(),
    title: `${String(row.symbol).trim().toUpperCase()} ${row.event_type || 'PDUFA'}: ${row.drug_name}`,
    description: row.indication || row.notes || null,
    source: 'manual_pdufa',
    source_id: makeSourceId([row.symbol, row.event_date, row.drug_name]),
    source_url: row.source_url || null,
    importance: Number(row.importance || 9),
    confidence: 'confirmed',
    metadata: {
      drug_name: row.drug_name,
      indication: row.indication || null,
      notes: row.notes || null,
    },
    raw_payload: row,
  };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: node server/ingestion/calendar/manual_pdufa_csv.js path/to/pdufa.csv');
  }

  const rows = rowsFromCsv(fs.readFileSync(filePath, 'utf8'));
  const events = rows.map(normalizeRow);
  const result = await upsertEvents(events);
  console.log(JSON.stringify({ rowsRead: rows.length, rowsAdded: result.inserted, rowsUpdated: result.updated, parseErrors: 0 }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  normalizeRow,
  parseCsvLine,
  rowsFromCsv,
};