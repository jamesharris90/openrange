const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { isDryRun, makeSourceId, runCalendarJob, upsertEvents } = require('./_helpers');

const STATIC_DIR = path.resolve(__dirname, './static_files');

function normalizeConferenceRow(row) {
  return {
    event_type: 'CONFERENCE',
    event_date: row.event_date,
    event_time: 'pre_market',
    title: row.title,
    description: row.industry || null,
    source: 'manual',
    source_id: makeSourceId(['conference', row.title, row.event_date]),
    source_url: row.source_url || null,
    importance: Number(row.importance || 5),
    confidence: 'confirmed',
    related_symbols: Array.isArray(row.related_symbols) ? row.related_symbols : [],
    metadata: {
      end_date: row.end_date || null,
      industry: row.industry || null,
    },
    raw_payload: row,
  };
}

function normalizeIndexRow(row) {
  return {
    event_type: 'INDEX_REBALANCE',
    event_date: row.event_date,
    title: row.title,
    description: row.description || null,
    source: 'manual',
    source_id: makeSourceId(['index_rebalance', row.title, row.event_date]),
    source_url: row.source_url || null,
    importance: Number(row.importance || 7),
    confidence: 'confirmed',
    related_symbols: Array.isArray(row.related_symbols) ? row.related_symbols : [],
    metadata: {
      end_date: row.end_date || null,
    },
    raw_payload: row,
  };
}

async function runIngest(options = {}) {
  return runCalendarJob('load_static_calendars', async () => {
    const dryRun = isDryRun(options);
    const conferences = JSON.parse(fs.readFileSync(path.join(STATIC_DIR, 'conferences.json'), 'utf8'));
    const indexRebalances = JSON.parse(fs.readFileSync(path.join(STATIC_DIR, 'index_rebalances.json'), 'utf8'));
    const events = [
      ...conferences.map(normalizeConferenceRow),
      ...indexRebalances.map(normalizeIndexRow),
    ];
    const persistence = await upsertEvents(events, null, { dryRun });
    return { dryRun, candidateEvents: events.length, conferenceCount: conferences.length, indexRebalanceCount: indexRebalances.length, ...persistence };
  }, options);
}

if (require.main === module) {
  runIngest({ dryRun: process.argv.includes('--dry-run') }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  normalizeConferenceRow,
  normalizeIndexRow,
  runIngest,
};