const crypto = require('crypto');
const { queryWithTimeout } = require('../db/pg');

const TOKEN_STOP_WORDS = new Set([
  'A', 'AN', 'AND', 'ARE', 'AS', 'AT', 'BY', 'FOR', 'FROM', 'IN', 'INTO', 'IS', 'IT',
  'NEW', 'NOT', 'NOW', 'OF', 'ON', 'OR', 'OUT', 'THE', 'TO', 'US', 'USA', 'WAS', 'WITH',
]);

function toText(value) {
  return String(value || '').trim();
}

function toTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function inferSentiment(text) {
  const value = String(text || '').toLowerCase();
  if (/beat|surge|rally|upgrade|record|bullish|approval|contract win/.test(value)) return 'positive';
  if (/miss|drop|plunge|downgrade|warning|lawsuit|bearish|offering/.test(value)) return 'negative';
  return 'neutral';
}

function inferCatalystType(text) {
  const value = String(text || '').toLowerCase();
  if (/earnings|eps|guidance|quarter/.test(value)) return 'earnings';
  if (/upgrade|downgrade|price target/.test(value)) return 'analyst';
  if (/fda|approval|clearance/.test(value)) return 'regulatory';
  if (/contract|partnership|deal|acquisition|merger/.test(value)) return 'corporate';
  if (/fed|rates|inflation|cpi|macro/.test(value)) return 'macro';
  return 'intel_inbox';
}

function extractNarrative(subject, body) {
  const text = `${toText(subject)}. ${toText(body)}`.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.slice(0, 400);
}

function extractTokenCandidates(input) {
  const text = String(input || '');
  const direct = text.match(/\$([A-Z]{1,5})\b/g) || [];
  const parens = text.match(/\(([A-Z]{1,5})\)/g) || [];
  const plain = text.toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];

  const merged = [
    ...direct.map((item) => item.replace('$', '')),
    ...parens.map((item) => item.replace(/[()]/g, '')),
    ...plain,
  ]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => value && !TOKEN_STOP_WORDS.has(value));

  return Array.from(new Set(merged));
}

async function ensureIntelInboxTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS intel_raw (
      id BIGSERIAL PRIMARY KEY,
      sender TEXT,
      subject TEXT,
      body TEXT,
      received_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'intel_inbox',
      raw_payload JSONB,
      fingerprint TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'services.intel_parser.ensure_intel_raw', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_intel_raw_received_at
     ON intel_raw(received_at DESC)`,
    [],
    { timeoutMs: 5000, label: 'services.intel_parser.idx_intel_raw_received_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS intel_news (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT,
      headline TEXT,
      source TEXT,
      url TEXT UNIQUE,
      published_at TIMESTAMPTZ,
      sentiment TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 7000, label: 'services.intel_parser.ensure_intel_news', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE intel_news
     ADD COLUMN IF NOT EXISTS catalyst_type TEXT,
     ADD COLUMN IF NOT EXISTS key_narrative TEXT,
     ADD COLUMN IF NOT EXISTS headline_hash TEXT`,
    [],
    { timeoutMs: 7000, label: 'services.intel_parser.extend_intel_news', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_intel_news_symbol_headline_hash
     ON intel_news(symbol, headline_hash)
     WHERE symbol IS NOT NULL AND headline_hash IS NOT NULL`,
    [],
    { timeoutMs: 5000, label: 'services.intel_parser.uq_intel_news_hash', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_catalysts (
      symbol TEXT,
      catalyst_type TEXT,
      headline TEXT,
      source TEXT,
      sentiment TEXT,
      published_at TIMESTAMP,
      score NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'services.intel_parser.ensure_trade_catalysts', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_catalyst_unique
     ON trade_catalysts(symbol, headline, published_at, catalyst_type)`,
    [],
    { timeoutMs: 5000, label: 'services.intel_parser.uq_trade_catalysts', maxRetries: 0 }
  );
}

async function resolveSymbols(explicitSymbol, subject, body) {
  const candidates = new Set();
  const cleaned = String(explicitSymbol || '').trim().toUpperCase();
  if (cleaned) candidates.add(cleaned);

  for (const token of extractTokenCandidates(`${subject} ${body}`)) {
    candidates.add(token);
  }

  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT UPPER(symbol) AS symbol
     FROM market_quotes
     WHERE symbol IS NOT NULL
       AND symbol <> ''
       AND symbol ~ '^[A-Z]{1,5}$'`,
    [],
    { timeoutMs: 5000, label: 'services.intel_parser.symbol_universe', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const valid = new Set((rows || []).map((row) => String(row.symbol || '').toUpperCase()));
  const output = Array.from(candidates).filter((symbol) => valid.has(symbol));

  return output;
}

async function ingestIntelInboxMessage(payload = {}) {
  await ensureIntelInboxTables();

  const sender = toText(payload.sender);
  const subject = toText(payload.subject);
  const body = toText(payload.body);
  const source = toText(payload.source) || 'intel_inbox';
  const receivedAt = toTimestamp(payload.timestamp || payload.received_at);

  if (!subject || !body) {
    throw new Error('subject and body are required');
  }

  const fingerprint = sha256(`${sender.toLowerCase()}|${subject.toLowerCase()}|${body.toLowerCase()}`);

  const rawInsert = await queryWithTimeout(
    `INSERT INTO intel_raw (
       sender, subject, body, received_at, source, raw_payload, fingerprint
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (fingerprint)
     DO UPDATE SET
       received_at = EXCLUDED.received_at,
       raw_payload = EXCLUDED.raw_payload
     RETURNING id, received_at`,
    [sender || null, subject, body, receivedAt.toISOString(), source, payload, fingerprint],
    { timeoutMs: 7000, label: 'services.intel_parser.insert_intel_raw', maxRetries: 0 }
  );

  const rawId = Number(rawInsert.rows?.[0]?.id || 0);
  const parsedSymbols = await resolveSymbols(payload.symbol, subject, body);
  const sentiment = inferSentiment(`${subject} ${body}`);
  const catalystType = inferCatalystType(`${subject} ${body}`);
  const keyNarrative = extractNarrative(subject, body);

  let parsedCount = 0;

  for (const symbol of parsedSymbols) {
    const headlineHash = sha256(`${symbol}|${subject.toLowerCase().replace(/\s+/g, ' ')}`);
    const url = `internal://intel-raw/${rawId}/${symbol}`;

    const exists = await queryWithTimeout(
      `SELECT 1
       FROM intel_news
       WHERE symbol = $1
         AND headline_hash = $2
       LIMIT 1`,
      [symbol, headlineHash],
      { timeoutMs: 4000, label: 'services.intel_parser.dedupe_intel_news', maxRetries: 0 }
    ).catch(() => ({ rows: [] }));

    if ((exists.rows || []).length > 0) {
      continue;
    }

    await queryWithTimeout(
      `INSERT INTO intel_news (
         symbol,
         headline,
         source,
         url,
         published_at,
         sentiment,
         catalyst_type,
         key_narrative,
         headline_hash,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (url)
       DO UPDATE SET
         symbol = EXCLUDED.symbol,
         headline = EXCLUDED.headline,
         source = EXCLUDED.source,
         published_at = EXCLUDED.published_at,
         sentiment = EXCLUDED.sentiment,
         catalyst_type = EXCLUDED.catalyst_type,
         key_narrative = EXCLUDED.key_narrative,
         headline_hash = EXCLUDED.headline_hash,
         updated_at = NOW()`,
      [
        symbol,
        subject,
        source,
        url,
        receivedAt.toISOString(),
        sentiment,
        catalystType,
        keyNarrative,
        headlineHash,
      ],
      { timeoutMs: 7000, label: 'services.intel_parser.upsert_intel_news', maxRetries: 0 }
    );

    await queryWithTimeout(
      `INSERT INTO trade_catalysts (
         symbol,
         catalyst_type,
         headline,
         source,
         sentiment,
         published_at,
         score,
         created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (symbol, headline, published_at, catalyst_type)
       DO UPDATE SET
         source = EXCLUDED.source,
         sentiment = EXCLUDED.sentiment,
         score = EXCLUDED.score,
         created_at = NOW()`,
      [
        symbol,
        'intel_inbox',
        subject,
        source,
        sentiment,
        receivedAt.toISOString(),
        9,
      ],
      { timeoutMs: 7000, label: 'services.intel_parser.upsert_trade_catalysts', maxRetries: 0 }
    );

    parsedCount += 1;
  }

  return {
    raw_id: rawId,
    symbols: parsedSymbols,
    parsed_count: parsedCount,
    sentiment,
    catalyst_type: catalystType,
    key_narrative: keyNarrative,
  };
}

module.exports = {
  ensureIntelInboxTables,
  ingestIntelInboxMessage,
};
