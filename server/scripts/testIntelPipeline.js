/* eslint-disable no-console */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const crypto = require('crypto');
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('../db/connectionConfig');
const { runCatalystSignalEngine } = require('../engines/catalystSignalEngine');

function sha256(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function failNow(message, detail = null, trace = {}) {
  const payload = {
    success: false,
    failure_points: [message],
    full_trace_log: trace,
    detail,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

async function postIntelInbox(baseUrl, intelKey, proxyApiKey, body) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-intel-key': intelKey,
  };
  if (proxyApiKey) {
    headers['x-api-key'] = proxyApiKey;
  }

  const response = await fetch(`${baseUrl}/api/intel-inbox`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch (_error) {
    json = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload: json,
  };
}

async function run() {
  const trace = {
    db: null,
    post: null,
    raw: null,
    parsed: null,
    catalyst: null,
    signal_engine: null,
    signal: null,
  };

  let client;

  try {
    const { dbUrl, host } = resolveDatabaseUrl();
    client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const dbPing = await client.query('SELECT NOW() AS now');
    trace.db = {
      host,
      now: dbPing.rows?.[0]?.now || null,
      connected: true,
    };

    const intelKey = process.env.INTEL_INGEST_KEY;
    const proxyApiKey = process.env.PROXY_API_KEY || null;
    if (!intelKey) {
      failNow('INTEL_INGEST_KEY missing', null, trace);
    }

    const apiBase =
      process.env.INTEL_PIPELINE_API_BASE
      || process.env.BACKEND_API_BASE
      || process.env.OPENRANGE_API_BASE
      || process.env.API_BASE
      || 'http://127.0.0.1:3001';
    const nowIso = new Date().toISOString();

    const inboxPayload = {
      subject: 'NVDA raises AI guidance, analysts upgrade price target',
      body: 'NVIDIA receives multiple upgrades following strong AI demand outlook. Analysts expect continued upside momentum.',
      sender: 'test@intel.com',
      timestamp: nowIso,
    };

    const postResult = await postIntelInbox(apiBase, intelKey, proxyApiKey, inboxPayload);
    trace.post = {
      url: `${apiBase}/api/intel-inbox`,
      status: postResult.status,
      payload: postResult.payload,
    };

    if (!postResult.ok) {
      failNow('POST /api/intel-inbox failed', postResult.payload, trace);
    }

    const expectedFingerprint = sha256(
      `${String(inboxPayload.sender || '').toLowerCase()}|${String(inboxPayload.subject || '').toLowerCase()}|${String(inboxPayload.body || '').toLowerCase()}`
    );

    const rawResult = await client.query(
      `SELECT id, fingerprint, sender, subject, received_at, created_at
       FROM intel_raw
       WHERE fingerprint = $1
       ORDER BY id DESC
       LIMIT 1`,
      [expectedFingerprint]
    );

    const rawRow = rawResult.rows?.[0] || null;
    trace.raw = rawRow;

    if (!rawRow) {
      failNow('FAIL: no raw row in intel_raw', null, trace);
    }

    const parsedResult = await client.query(
      `SELECT id, symbol, sentiment, key_narrative, headline, source, published_at
       FROM intel_news
       WHERE symbol = 'NVDA'
         AND headline = $1
       ORDER BY id DESC
       LIMIT 1`,
      [inboxPayload.subject]
    );

    const parsedRow = parsedResult.rows?.[0] || null;
    trace.parsed = parsedRow;

    if (!parsedRow) {
      failNow('FAIL: no parsed intel row in intel_news for NVDA', null, trace);
    }

    if (!parsedRow.symbol || String(parsedRow.symbol).toUpperCase() !== 'NVDA') {
      failNow('FAIL: no symbol extracted as NVDA', parsedRow, trace);
    }

    if (!parsedRow.sentiment) {
      failNow('FAIL: parsed sentiment missing', parsedRow, trace);
    }

    if (!parsedRow.key_narrative) {
      failNow('FAIL: parsed narrative missing', parsedRow, trace);
    }

    const catalystEventResult = await client.query(
      `SELECT event_uuid::text AS id, strength_score, source_table, created_at
       FROM catalyst_events
       WHERE symbol = 'NVDA'
         AND headline = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [inboxPayload.subject]
    ).catch(() => ({ rows: [] }));

    let catalystRow = catalystEventResult.rows?.[0] || null;

    if (!catalystRow) {
      const tradeCatalystResult = await client.query(
        `SELECT
           CONCAT(symbol, '|', COALESCE(published_at::text, created_at::text), '|', LEFT(headline, 40)) AS id,
           score::double precision AS strength_score,
           source,
           created_at
         FROM trade_catalysts
         WHERE symbol = 'NVDA'
           AND headline = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [inboxPayload.subject]
      ).catch(() => ({ rows: [] }));

      catalystRow = tradeCatalystResult.rows?.[0] || null;
    }

    trace.catalyst = catalystRow;

    if (!catalystRow) {
      failNow('FAIL: no catalyst created in trade_catalysts or catalyst_events', null, trace);
    }

    const signalEngineResult = await runCatalystSignalEngine().catch((error) => ({
      ok: false,
      error: error?.message || String(error),
    }));
    trace.signal_engine = signalEngineResult;

    const signalResult = await client.query(
      `SELECT id::text, symbol, signal_score AS confidence, signal_type, created_at
       FROM catalyst_signals
       WHERE symbol = 'NVDA'
         AND created_at >= NOW() - INTERVAL '6 hours'
       ORDER BY created_at DESC
       LIMIT 1`
    ).catch(() => ({ rows: [] }));

    let signalRow = signalResult.rows?.[0] || null;

    if (!signalRow) {
      const fallbackSignalResult = await client.query(
        `SELECT id::text, symbol, confidence, signal_type, created_at
       FROM signals
       WHERE symbol = 'NVDA'
         AND created_at >= NOW() - INTERVAL '6 hours'
       ORDER BY created_at DESC
       LIMIT 1`
      ).catch(() => ({ rows: [] }));
      signalRow = fallbackSignalResult.rows?.[0] || null;
    }

    trace.signal = signalRow;

    const failurePoints = [];
    if (!signalRow) {
      failurePoints.push('FAIL: no NVDA signal found after catalyst stage (thresholds unmet or pipeline gap)');
    }

    console.log('RAW:');
    console.log(JSON.stringify({ id: rawRow.id, fingerprint: rawRow.fingerprint }, null, 2));

    console.log('PARSED:');
    console.log(JSON.stringify({ symbol: parsedRow.symbol, sentiment: parsedRow.sentiment, narrative: parsedRow.key_narrative }, null, 2));

    console.log('CATALYST:');
    console.log(JSON.stringify({ id: catalystRow.id, strength_score: catalystRow.strength_score }, null, 2));

    console.log('SIGNAL:');
    console.log(JSON.stringify(signalRow ? { id: signalRow.id, confidence: signalRow.confidence } : { id: null, confidence: null }, null, 2));

    const success = failurePoints.length === 0;

    console.log(JSON.stringify({
      success,
      full_trace_log: trace,
      failure_points: failurePoints,
    }, null, 2));

    if (!success) {
      process.exitCode = 2;
    }
  } catch (error) {
    failNow('DB/PIPELINE ERROR', error.message || String(error), trace);
  } finally {
    if (client) {
      await client.end().catch(() => {});
    }
  }
}

run();
