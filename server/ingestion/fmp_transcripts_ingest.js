const fs = require('fs').promises;
const path = require('path');
const { fmpFetch } = require('../services/fmpClient');
const logger = require('../utils/logger');
const { pool } = require('../db/pg');

async function ensureTranscriptsTable() {
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_earnings_transcripts.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

async function getEarningsDateColumn() {
  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'earnings_events'
       AND column_name IN ('report_date', 'earnings_date')`
  );

  const names = new Set(rows.map((row) => row.column_name));
  if (names.has('report_date')) return 'report_date';
  if (names.has('earnings_date')) return 'earnings_date';
  return null;
}

function quarterFromDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const month = date.getUTCMonth();
  return Math.floor(month / 3) + 1;
}

async function getTranscriptCandidates(limit = 400) {
  const dateColumn = await getEarningsDateColumn();
  if (!dateColumn) return [];

  const query = `SELECT DISTINCT symbol, ${dateColumn}::date AS report_date
                 FROM earnings_events
                 WHERE ${dateColumn} IS NOT NULL
                   AND ${dateColumn} >= CURRENT_DATE - INTERVAL '180 days'
                 ORDER BY ${dateColumn} DESC
                 LIMIT $1`;

  const { rows } = await pool.query(query, [limit]);
  return rows
    .map((row) => {
      const reportDate = row.report_date;
      const quarter = quarterFromDate(reportDate);
      const year = Number(new Date(reportDate).getUTCFullYear());
      if (!quarter || !Number.isFinite(year)) return null;
      return {
        symbol: String(row.symbol || '').trim().toUpperCase(),
        report_date: reportDate,
        fiscal_quarter: quarter,
        fiscal_year: year,
      };
    })
    .filter((row) => row && row.symbol);
}

function toTranscriptText(record) {
  if (!record || typeof record !== 'object') return '';
  const raw = record.content || record.transcript || record.text || record.body || '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

async function fetchTranscriptWithFallback(symbol, fiscalYear, fiscalQuarter) {
  const paths = [
    `/earning_call_transcript?symbol=${encodeURIComponent(symbol)}&year=${fiscalYear}&quarter=${fiscalQuarter}`,
    `/earning-call-transcript?symbol=${encodeURIComponent(symbol)}&year=${fiscalYear}&quarter=${fiscalQuarter}`,
  ];

  let lastError = null;
  for (const endpoint of paths) {
    try {
      const payload = await fmpFetch(endpoint);
      const rows = Array.isArray(payload) ? payload : [payload];
      const transcriptRow = rows.find((row) => toTranscriptText(row));
      const transcriptText = toTranscriptText(transcriptRow || rows[0]);
      if (transcriptText) {
        return {
          transcript_status: 'available',
          transcript_text: transcriptText,
          raw_payload: transcriptRow || rows[0] || {},
        };
      }
    } catch (error) {
      lastError = error;
      if (Number(error?.status) === 404) {
        continue;
      }
      throw error;
    }
  }

  return {
    transcript_status: 'missing',
    transcript_text: 'Transcript unavailable from provider for this earnings period.',
    raw_payload: {
      reason: 'provider_404_or_empty',
      last_error: lastError?.message || null,
    },
  };
}

async function upsertTranscriptRows(rows) {
  if (!rows.length) return 0;

  let inserted = 0;
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    const payload = JSON.stringify(chunk);

    await pool.query(
      `INSERT INTO earnings_transcripts (
         symbol,
         fiscal_year,
         fiscal_quarter,
         report_date,
         source,
         transcript_status,
         transcript_text,
         raw_payload,
         updated_at
       )
       SELECT symbol,
              fiscal_year,
              fiscal_quarter,
              report_date,
              source,
              transcript_status,
              transcript_text,
              raw_payload,
              NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(
         symbol text,
         fiscal_year int,
         fiscal_quarter int,
         report_date date,
         source text,
         transcript_status text,
         transcript_text text,
         raw_payload jsonb,
         updated_at timestamptz
       )
       ON CONFLICT (symbol, fiscal_year, fiscal_quarter) DO UPDATE
       SET report_date = EXCLUDED.report_date,
           source = EXCLUDED.source,
           transcript_status = EXCLUDED.transcript_status,
           transcript_text = EXCLUDED.transcript_text,
           raw_payload = EXCLUDED.raw_payload,
           updated_at = NOW()`,
      [payload]
    );

    inserted += chunk.length;
  }

  return inserted;
}

async function runTranscriptsIngestion() {
  const startedAt = Date.now();
  await ensureTranscriptsTable();

  const candidates = await getTranscriptCandidates();
  if (!candidates.length) {
    return {
      jobName: 'fmp_transcripts_ingest',
      scanned: 0,
      inserted: 0,
      available: 0,
      missing: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const rows = [];
  let available = 0;
  let missing = 0;

  for (const item of candidates) {
    try {
      const transcript = await fetchTranscriptWithFallback(item.symbol, item.fiscal_year, item.fiscal_quarter);
      if (transcript.transcript_status === 'available') {
        available += 1;
      } else {
        missing += 1;
      }

      rows.push({
        symbol: item.symbol,
        fiscal_year: item.fiscal_year,
        fiscal_quarter: item.fiscal_quarter,
        report_date: item.report_date,
        source: 'fmp',
        transcript_status: transcript.transcript_status,
        transcript_text: transcript.transcript_text,
        raw_payload: transcript.raw_payload,
      });
    } catch (error) {
      missing += 1;
      rows.push({
        symbol: item.symbol,
        fiscal_year: item.fiscal_year,
        fiscal_quarter: item.fiscal_quarter,
        report_date: item.report_date,
        source: 'fmp',
        transcript_status: 'missing',
        transcript_text: 'Transcript unavailable due to upstream error.',
        raw_payload: {
          reason: 'upstream_error',
          error: error.message,
        },
      });
      logger.warn('transcript ingestion fallback row inserted', {
        symbol: item.symbol,
        fiscal_year: item.fiscal_year,
        fiscal_quarter: item.fiscal_quarter,
        error: error.message,
      });
    }
  }

  const inserted = await upsertTranscriptRows(rows);

  const summary = {
    jobName: 'fmp_transcripts_ingest',
    scanned: candidates.length,
    inserted,
    available,
    missing,
    durationMs: Date.now() - startedAt,
  };

  logger.info('transcript ingestion done', summary);
  return summary;
}

module.exports = {
  runTranscriptsIngestion,
};
