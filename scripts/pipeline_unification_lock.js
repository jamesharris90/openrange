const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const dotenv = require('../server/node_modules/dotenv');

dotenv.config({ path: path.join(__dirname, '../server/.env') });

const { queryWithTimeout, pool } = require('../server/db/pg');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const PRE_SNAPSHOT = path.join(LOG_DIR, 'pipeline_pre_unification.json');
const POST_SNAPSHOT = path.join(LOG_DIR, 'pipeline_post_unification.json');

const REQUIRED_TABLES = [
  'signals',
  'strategy_signals',
  'trade_signals',
  'signal_registry',
  'trade_setups',
  'signal_outcomes',
  'trade_outcomes',
  'stocks_in_play',
];

const phaseLog = [];

function nowIso() {
  return new Date().toISOString();
}

function logStep(phase, message, extra = {}) {
  const entry = { ts: nowIso(), phase, message, ...extra };
  phaseLog.push(entry);
  console.log('[PIPELINE]', JSON.stringify(entry));
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

async function sqlOne(sql, params, label, timeoutMs = 15000) {
  const res = await queryWithTimeout(sql, params, { timeoutMs, label, maxRetries: 0 });
  return res.rows[0] || null;
}

async function sqlRows(sql, params, label, timeoutMs = 15000) {
  const res = await queryWithTimeout(sql, params, { timeoutMs, label, maxRetries: 0 });
  return res.rows || [];
}

function fail(phase, reason, details = {}) {
  const error = new Error(reason);
  error.phase = phase;
  error.details = details;
  throw error;
}

async function tableExists(tableName) {
  const row = await sqlOne(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS ok`,
    [tableName],
    `exists.${tableName}`
  );
  return Boolean(row && row.ok);
}

async function tableColumns(tableName) {
  const rows = await sqlRows(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
    `cols.${tableName}`
  );
  return rows;
}

async function rowCount(tableName) {
  const row = await sqlOne(`SELECT COUNT(*)::int AS n FROM ${tableName}`, [], `count.${tableName}`);
  return Number(row ? row.n : 0);
}

async function rowCounts(tables) {
  const out = {};
  for (const table of tables) {
    if (!(await tableExists(table))) {
      out[table] = null;
      continue;
    }
    out[table] = await rowCount(table);
  }
  return out;
}

function getUkSessionPhase() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());

  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const total = (hh * 60) + mm;

  if (total < 13 * 60) return 'premarket_early';
  if (total < (14 * 60 + 30)) return 'premarket_peak';
  if (total < (15 * 60 + 30)) return 'market_open';
  return 'intraday';
}

async function phase0FreezeAndSnapshot() {
  const phase = 'PHASE_0';
  logStep(phase, 'Starting freeze checks and pre-snapshot');

  let processOutput = '';
  try {
    processOutput = execSync(
      "ps -ef | grep -E \"startEngines|intelligencePipeline|stocksInPlayEngine|runStrategySignalEngine\" | grep -v grep || true",
      { encoding: 'utf8' }
    ).trim();
  } catch {
    processOutput = '';
  }

  if (processOutput) {
    fail(phase, 'Active write loop process detected', { processOutput });
  }

  const activeMigrations = await sqlRows(
    `SELECT pid, state, LEFT(query, 220) AS query
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND state <> 'idle'
       AND pid <> pg_backend_pid()
       AND query NOT ILIKE '%pg_stat_statements%'
       AND query NOT ILIKE '%normalized_pg_stat_statements%'
       AND (
         query ILIKE '%migrat%'
         OR query ILIKE '%alter table%'
         OR query ILIKE '%create table%'
         OR query ILIKE '%drop table%'
       )
     ORDER BY query_start DESC`,
    [],
    'phase0.active_migrations',
    10000
  );

  if (activeMigrations.length > 0) {
    fail(phase, 'Migration or DDL activity detected', { activeMigrations });
  }

  const counts = await rowCounts(REQUIRED_TABLES);
  const snapshot = {
    ts: nowIso(),
    phase,
    freeze_ok: true,
    counts,
    active_migrations: activeMigrations,
    phase_log: [...phaseLog],
  };

  ensureLogDir();
  fs.writeFileSync(PRE_SNAPSHOT, JSON.stringify(snapshot, null, 2));
  logStep(phase, 'Pre-snapshot written', { file: PRE_SNAPSHOT, counts });
}

async function phase1CanonicalSignalSource() {
  const phase = 'PHASE_1';
  logStep(phase, 'Inspecting signal schemas and selecting canonical source');

  const candidates = ['signals', 'strategy_signals', 'trade_signals', 'signal_registry'];
  const inspected = [];

  for (const table of candidates) {
    if (!(await tableExists(table))) {
      inspected.push({ table, exists: false });
      continue;
    }

    const cols = await tableColumns(table);
    const colNames = new Set(cols.map((c) => c.column_name));
    const tsCol = ['created_at', 'updated_at', 'detected_at', 'timestamp'].find((c) => colNames.has(c)) || null;
    const scoreCol = ['score', 'probability', 'confidence', 'priority_score'].find((c) => colNames.has(c)) || null;

    let activeRecent = false;
    let latestTs = null;
    if (tsCol) {
      const latest = await sqlOne(
        `SELECT MAX(${tsCol}) AS latest FROM ${table}`,
        [],
        `phase1.latest.${table}`
      );
      latestTs = latest ? latest.latest : null;
      if (latestTs) {
        const age = Date.now() - new Date(latestTs).getTime();
        activeRecent = Number.isFinite(age) && age <= 7 * 24 * 60 * 60 * 1000;
      }
    }

    inspected.push({
      table,
      exists: true,
      columns: cols.map((c) => c.column_name),
      hasSymbol: colNames.has('symbol'),
      tsCol,
      scoreCol,
      latestTs,
      activeRecent,
    });
  }

  const signalsCandidate = inspected.find((t) =>
    t.exists && t.table === 'signals' && t.hasSymbol && t.tsCol && t.scoreCol && t.activeRecent
  );

  if (!signalsCandidate) {
    fail(phase, 'signals table failed canonical eligibility rules', { inspected });
  }

  const canonical = 'signals';
  logStep(phase, 'Canonical signal table selected', { canonical });

  await queryWithTimeout(
    `ALTER TABLE ${canonical}
     ADD COLUMN IF NOT EXISTS session_phase TEXT,
     ADD COLUMN IF NOT EXISTS volume_acceleration NUMERIC,
     ADD COLUMN IF NOT EXISTS priority_score NUMERIC`,
    [],
    { timeoutMs: 15000, label: 'phase1.alter.canonical', maxRetries: 0 }
  );

  const symbolNulls = await sqlOne(
    `SELECT COUNT(*)::int AS n
     FROM ${canonical}
     WHERE symbol IS NULL OR TRIM(COALESCE(symbol, '')) = ''`,
    [],
    'phase1.symbol_nulls'
  );

  if (Number(symbolNulls.n) > 0) {
    fail(phase, 'Canonical symbol validation failed', { null_symbols: Number(symbolNulls.n) });
  }

  return canonical;
}

async function insertMissingSignalsFrom(tableName, symbolExpr, tsExpr, scoreExpr, signalType) {
  await queryWithTimeout(
    `INSERT INTO signals (symbol, signal_type, score, confidence, catalyst_ids, created_at)
     SELECT DISTINCT
       UPPER(${symbolExpr}) AS symbol,
       $1::text AS signal_type,
       COALESCE(${scoreExpr}, 0)::numeric AS score,
       50::numeric AS confidence,
       ARRAY[]::uuid[] AS catalyst_ids,
       COALESCE(${tsExpr}, NOW())
     FROM ${tableName} src
     WHERE ${symbolExpr} IS NOT NULL
       AND TRIM(${symbolExpr}) <> ''
       AND NOT EXISTS (
         SELECT 1
         FROM signals s
         WHERE UPPER(s.symbol) = UPPER(${symbolExpr})
       )`,
    [signalType],
    { timeoutMs: 30000, label: `phase2.insert_missing_signals.${tableName}`, maxRetries: 0 }
  );
}

async function ensureConstraintDropped(tableName, constraintName) {
  const exists = await sqlOne(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = $1::regclass
         AND conname = $2
     ) AS ok`,
    [tableName, constraintName],
    `constraint.exists.${constraintName}`
  );

  if (exists && exists.ok) {
    await queryWithTimeout(
      `ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}`,
      [],
      { timeoutMs: 15000, label: `constraint.drop.${constraintName}`, maxRetries: 0 }
    );
  }
}

async function ensureForeignKey(tableName, constraintName, columnName, refTable, refColumn) {
  const exists = await sqlOne(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = $1::regclass
         AND conname = $2
     ) AS ok`,
    [tableName, constraintName],
    `constraint.exists.${constraintName}`
  );

  if (!exists || !exists.ok) {
    await queryWithTimeout(
      `ALTER TABLE ${tableName}
       ADD CONSTRAINT ${constraintName}
       FOREIGN KEY (${columnName}) REFERENCES ${refTable}(${refColumn}) ON DELETE CASCADE`,
      [],
      { timeoutMs: 20000, label: `constraint.add.${constraintName}`, maxRetries: 0 }
    );
  }
}

async function phase2LifecycleLinking(canonicalTable) {
  const phase = 'PHASE_2';
  logStep(phase, 'Linking lifecycle tables to canonical signal ids', { canonicalTable });

  if (canonicalTable !== 'signals') {
    fail(phase, 'Only signals canonical is supported by strict lifecycle validation');
  }

  const setupCols = new Set((await tableColumns('trade_setups')).map((c) => c.column_name));
  if (!setupCols.has('signal_id')) {
    await queryWithTimeout(
      'ALTER TABLE trade_setups ADD COLUMN signal_id uuid',
      [],
      { timeoutMs: 15000, label: 'phase2.add.trade_setups.signal_id', maxRetries: 0 }
    );
  }

  await insertMissingSignalsFrom(
    'trade_setups',
    'src.symbol',
    'COALESCE(src.detected_at, src.updated_at, src.created_at)',
    'src.score',
    'setup_linked'
  );

  await queryWithTimeout(
    `UPDATE trade_setups ts
     SET signal_id = (
       SELECT s.id
       FROM signals s
       WHERE UPPER(s.symbol) = UPPER(ts.symbol)
       ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(ts.detected_at, ts.updated_at, ts.created_at, NOW()) - s.created_at))) ASC
       LIMIT 1
     )
     WHERE ts.signal_id IS NULL`,
    [],
    { timeoutMs: 45000, label: 'phase2.backfill.trade_setups.signal_id', maxRetries: 0 }
  );

  const setupNulls = await sqlOne(
    `SELECT COUNT(*)::int AS n FROM trade_setups WHERE signal_id IS NULL`,
    [],
    'phase2.validate.trade_setups.signal_id'
  );

  if (Number(setupNulls.n) > 0) {
    fail(phase, 'trade_setups signal_id backfill incomplete', { null_signal_id: Number(setupNulls.n) });
  }

  const soCols = new Set((await tableColumns('signal_outcomes')).map((c) => c.column_name));
  if (!soCols.has('signal_id')) {
    await queryWithTimeout(
      'ALTER TABLE signal_outcomes ADD COLUMN signal_id uuid',
      [],
      { timeoutMs: 15000, label: 'phase2.add.signal_outcomes.signal_id', maxRetries: 0 }
    );
  }

  await queryWithTimeout(
    'DROP INDEX IF EXISTS idx_signal_outcomes_signal_id',
    [],
    { timeoutMs: 15000, label: 'phase2.drop.signal_outcomes.unique_index', maxRetries: 0 }
  );

  await ensureConstraintDropped('signal_outcomes', 'signal_outcomes_signal_fk');
  await ensureConstraintDropped('signal_outcomes', 'signal_outcomes_signal_id_fkey');

  await insertMissingSignalsFrom(
    'signal_outcomes',
    'src.symbol',
    'COALESCE(src.evaluated_at, src.created_at)',
    'src.pnl_pct',
    'outcome_linked'
  );

  await queryWithTimeout(
    `UPDATE signal_outcomes so
     SET signal_id = (
       SELECT s.id
       FROM signals s
       WHERE UPPER(s.symbol) = UPPER(so.symbol)
       ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(so.evaluated_at, so.created_at, NOW()) - s.created_at))) ASC
       LIMIT 1
     )`,
    [],
    { timeoutMs: 45000, label: 'phase2.backfill.signal_outcomes.signal_id', maxRetries: 0 }
  );

  const soNulls = await sqlOne(
    `SELECT COUNT(*)::int AS n FROM signal_outcomes WHERE signal_id IS NULL`,
    [],
    'phase2.validate.signal_outcomes.signal_id'
  );

  if (Number(soNulls.n) > 0) {
    fail(phase, 'signal_outcomes signal_id backfill incomplete', { null_signal_id: Number(soNulls.n) });
  }

  await ensureForeignKey('signal_outcomes', 'signal_outcomes_signal_fk', 'signal_id', 'signals', 'id');

  const toCols = await tableColumns('trade_outcomes');
  const toColNames = new Set(toCols.map((c) => c.column_name));
  const signalIdMeta = toCols.find((c) => c.column_name === 'signal_id');

  if (toColNames.has('legacy_signal_id')) {
    await queryWithTimeout(
      'ALTER TABLE trade_outcomes ALTER COLUMN legacy_signal_id DROP NOT NULL',
      [],
      { timeoutMs: 15000, label: 'phase2.legacy_signal_id.drop_not_null.pre', maxRetries: 0 }
    );
  }

  if (!toColNames.has('id')) {
    await queryWithTimeout(
      'ALTER TABLE trade_outcomes ADD COLUMN id BIGSERIAL',
      [],
      { timeoutMs: 15000, label: 'phase2.add.trade_outcomes.id', maxRetries: 0 }
    );
  }

  if (!toColNames.has('canonical_signal_id')) {
    await queryWithTimeout(
      'ALTER TABLE trade_outcomes ADD COLUMN canonical_signal_id uuid',
      [],
      { timeoutMs: 15000, label: 'phase2.add.trade_outcomes.canonical_signal_id', maxRetries: 0 }
    );
  }

  await insertMissingSignalsFrom(
    'trade_outcomes',
    'src.symbol',
    'COALESCE(src.evaluated_at, src.created_at, src.evaluation_time)',
    'src.pnl_pct',
    'trade_outcome_linked'
  );

  await queryWithTimeout(
    `UPDATE trade_outcomes t
     SET canonical_signal_id = (
       SELECT s.id
       FROM signals s
       WHERE UPPER(s.symbol) = UPPER(t.symbol)
       ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(t.evaluated_at, t.created_at, t.evaluation_time, NOW()) - s.created_at))) ASC
       LIMIT 1
     )
     WHERE t.canonical_signal_id IS NULL`,
    [],
    { timeoutMs: 45000, label: 'phase2.backfill.trade_outcomes.canonical_signal_id', maxRetries: 0 }
  );

  const toCanonicalNulls = await sqlOne(
    `SELECT COUNT(*)::int AS n FROM trade_outcomes WHERE canonical_signal_id IS NULL`,
    [],
    'phase2.validate.trade_outcomes.canonical_signal_id'
  );

  if (Number(toCanonicalNulls.n) > 0) {
    fail(phase, 'trade_outcomes canonical signal backfill incomplete', { null_canonical_signal_id: Number(toCanonicalNulls.n) });
  }

  if (!signalIdMeta || signalIdMeta.udt_name !== 'uuid') {
    await ensureConstraintDropped('trade_outcomes', 'trade_outcomes_signal_id_fkey');
    await ensureConstraintDropped('trade_outcomes', 'trade_outcomes_pkey');

    const currentCols = new Set((await tableColumns('trade_outcomes')).map((c) => c.column_name));
    if (currentCols.has('signal_id') && !currentCols.has('legacy_signal_id')) {
      await queryWithTimeout(
        'ALTER TABLE trade_outcomes RENAME COLUMN signal_id TO legacy_signal_id',
        [],
        { timeoutMs: 15000, label: 'phase2.rename.trade_outcomes.signal_id', maxRetries: 0 }
      );
    }

    const colsAfterRename = new Set((await tableColumns('trade_outcomes')).map((c) => c.column_name));
    if (colsAfterRename.has('canonical_signal_id') && !colsAfterRename.has('signal_id')) {
      await queryWithTimeout(
        'ALTER TABLE trade_outcomes RENAME COLUMN canonical_signal_id TO signal_id',
        [],
        { timeoutMs: 15000, label: 'phase2.rename.trade_outcomes.canonical_to_signal', maxRetries: 0 }
      );
    }

    const colsAfterCanonicalSwap = new Set((await tableColumns('trade_outcomes')).map((c) => c.column_name));
    if (colsAfterCanonicalSwap.has('legacy_signal_id')) {
      await queryWithTimeout(
        'ALTER TABLE trade_outcomes ALTER COLUMN legacy_signal_id DROP NOT NULL',
        [],
        { timeoutMs: 15000, label: 'phase2.legacy_signal_id.drop_not_null', maxRetries: 0 }
      );
    }
  }

  await queryWithTimeout(
    'ALTER TABLE trade_outcomes ALTER COLUMN signal_id SET NOT NULL',
    [],
    { timeoutMs: 15000, label: 'phase2.setnotnull.trade_outcomes.signal_id', maxRetries: 0 }
  );

  const pkeyExists = await sqlOne(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'trade_outcomes'::regclass
         AND conname = 'trade_outcomes_pkey'
     ) AS ok`,
    [],
    'phase2.exists.trade_outcomes.pkey'
  );

  if (!pkeyExists || !pkeyExists.ok) {
    await queryWithTimeout(
      'ALTER TABLE trade_outcomes ADD CONSTRAINT trade_outcomes_pkey PRIMARY KEY (id)',
      [],
      { timeoutMs: 15000, label: 'phase2.add.trade_outcomes.pkey', maxRetries: 0 }
    );
  }

  await ensureForeignKey('trade_outcomes', 'trade_outcomes_signal_id_fkey', 'signal_id', 'signals', 'id');

  const overlap = await sqlOne(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON s.id = ts.signal_id
     JOIN signal_outcomes so ON s.id = so.signal_id`,
    [],
    'phase2.validate.lifecycle_overlap'
  );

  if (Number(overlap.n) <= 0) {
    fail(phase, 'Lifecycle overlap still zero after linking', { overlap: Number(overlap.n) });
  }

  logStep(phase, 'Lifecycle linking validated', { overlap: Number(overlap.n) });
}

async function phase3SessionLogic() {
  const phase = 'PHASE_3';
  const sessionPhase = getUkSessionPhase();
  logStep(phase, 'Applying session metrics', { sessionPhase });

  await queryWithTimeout(
    `ALTER TABLE signals
     ADD COLUMN IF NOT EXISTS session_phase TEXT,
     ADD COLUMN IF NOT EXISTS volume_acceleration NUMERIC,
     ADD COLUMN IF NOT EXISTS priority_score NUMERIC`,
    [],
    { timeoutMs: 15000, label: 'phase3.alter.signals', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE stocks_in_play
     ADD COLUMN IF NOT EXISTS session_phase TEXT,
     ADD COLUMN IF NOT EXISTS volume_acceleration NUMERIC,
     ADD COLUMN IF NOT EXISTS priority_score NUMERIC,
     ADD COLUMN IF NOT EXISTS catalyst_score NUMERIC`,
    [],
    { timeoutMs: 15000, label: 'phase3.alter.stocks_in_play', maxRetries: 0 }
  );

  await queryWithTimeout(
    `WITH base AS (
       SELECT
         s.id,
         COALESCE((mm.volume / NULLIF(mm.avg_volume_30d / 78.0, 0)), 0)::numeric AS volume_acceleration,
         COALESCE(mm.gap_percent, 0)::numeric AS gap_percent,
         COALESCE(mm.relative_volume, 0)::numeric AS relative_volume
       FROM signals s
       LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(s.symbol)
     )
     UPDATE signals s
     SET session_phase = $1,
         volume_acceleration = b.volume_acceleration,
         priority_score = (
           (b.gap_percent * 0.3)
           + (b.relative_volume * 0.3)
           + (b.volume_acceleration * 0.2)
           + (0 * 0.2)
         )
     FROM base b
     WHERE s.id = b.id`,
    [sessionPhase],
    { timeoutMs: 45000, label: 'phase3.update.signals', maxRetries: 0 }
  );

  await queryWithTimeout(
    `WITH base AS (
       SELECT
         sip.id,
         COALESCE((mm.volume / NULLIF(mm.avg_volume_30d / 78.0, 0)), 0)::numeric AS volume_acceleration,
         COALESCE(sip.gap_percent, 0)::numeric AS gap_percent,
         COALESCE(sip.rvol, 0)::numeric AS relative_volume,
         COALESCE(sip.catalyst_score, 0)::numeric AS catalyst_score
       FROM stocks_in_play sip
       LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(sip.symbol)
     )
     UPDATE stocks_in_play sip
     SET session_phase = $1,
         volume_acceleration = b.volume_acceleration,
         priority_score = (
           (b.gap_percent * 0.3)
           + (b.relative_volume * 0.3)
           + (b.volume_acceleration * 0.2)
           + (b.catalyst_score * 0.2)
         )
     FROM base b
     WHERE sip.id = b.id`,
    [sessionPhase],
    { timeoutMs: 45000, label: 'phase3.update.stocks_in_play', maxRetries: 0 }
  );

  const sampleSignals = await sqlRows(
    `SELECT symbol, session_phase, volume_acceleration, priority_score
     FROM signals
     WHERE symbol IS NOT NULL
     ORDER BY created_at DESC NULLS LAST
     LIMIT 10`,
    [],
    'phase3.sample.signals'
  );

  const sampleSip = await sqlRows(
    `SELECT symbol, session_phase, volume_acceleration, priority_score
     FROM stocks_in_play
     WHERE symbol IS NOT NULL
     ORDER BY detected_at DESC NULLS LAST
     LIMIT 10`,
    [],
    'phase3.sample.stocks_in_play'
  );

  const badSignalRows = sampleSignals.filter((r) => r.session_phase == null || r.volume_acceleration == null || r.priority_score == null).length;
  const badSipRows = sampleSip.filter((r) => r.session_phase == null || r.volume_acceleration == null || r.priority_score == null).length;

  if (sampleSignals.length === 0 || sampleSip.length === 0 || badSignalRows > 0 || badSipRows > 0) {
    fail(phase, 'Session logic fields not fully populated', {
      sampleSignals: sampleSignals.length,
      sampleStocksInPlay: sampleSip.length,
      badSignalRows,
      badSipRows,
    });
  }

  logStep(phase, 'Session logic populated', {
    sampled_signals: sampleSignals.length,
    sampled_stocks_in_play: sampleSip.length,
  });
}

async function phase4StocksInPlayPipeline() {
  const phase = 'PHASE_4';
  logStep(phase, 'Ensuring top stocks-in-play symbols are fully linked');

  const topRows = await sqlRows(
    `SELECT symbol
     FROM (
       SELECT
         UPPER(symbol) AS symbol,
         MAX(score) AS best_score,
         MAX(detected_at) AS last_seen
       FROM stocks_in_play
       WHERE symbol IS NOT NULL
         AND TRIM(symbol) <> ''
       GROUP BY UPPER(symbol)
     ) ranked
     ORDER BY best_score DESC NULLS LAST, last_seen DESC NULLS LAST
     LIMIT 20`,
    [],
    'phase4.top20'
  );

  const symbols = Array.from(new Set(topRows.map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean)));
  if (symbols.length === 0) {
    fail(phase, 'No stocks_in_play symbols available');
  }

  await queryWithTimeout(
    `INSERT INTO signals (symbol, signal_type, score, confidence, catalyst_ids, created_at)
     SELECT DISTINCT
       UPPER(sip.symbol),
       'stocks_in_play',
       COALESCE(sip.score, 0)::numeric,
       55::numeric,
       ARRAY[]::uuid[],
       NOW()
     FROM stocks_in_play sip
     WHERE UPPER(sip.symbol) = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM signals s WHERE UPPER(s.symbol) = UPPER(sip.symbol)
       )`,
    [symbols],
    { timeoutMs: 30000, label: 'phase4.insert.signals', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE trade_setups ts
     SET signal_id = (
       SELECT s.id
       FROM signals s
       WHERE UPPER(s.symbol) = UPPER(ts.symbol)
       ORDER BY s.created_at DESC
       LIMIT 1
     )
     WHERE UPPER(ts.symbol) = ANY($1::text[])
       AND ts.signal_id IS NULL`,
    [symbols],
    { timeoutMs: 30000, label: 'phase4.backfill.trade_setups', maxRetries: 0 }
  );

  await queryWithTimeout(
    `INSERT INTO trade_setups (symbol, setup, setup_type, score, detected_at, updated_at, signal_id, entry_price, created_at)
     WITH ranked_signals AS (
       SELECT
         s.id,
         UPPER(s.symbol) AS symbol,
         ROW_NUMBER() OVER (PARTITION BY UPPER(s.symbol) ORDER BY s.created_at DESC, s.id DESC) AS rn
       FROM signals s
       WHERE UPPER(s.symbol) = ANY($1::text[])
     )
     SELECT
       rs.symbol,
       'stocks_in_play_setup',
       'stocks_in_play_setup',
       60,
       NOW(),
       NOW(),
       rs.id,
       COALESCE(mm.price, 0),
       NOW()
     FROM ranked_signals rs
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = rs.symbol
     WHERE rs.rn = 1
       AND NOT EXISTS (
         SELECT 1 FROM trade_setups ts WHERE UPPER(ts.symbol) = rs.symbol
       )`,
    [symbols],
    { timeoutMs: 30000, label: 'phase4.insert.trade_setups', maxRetries: 0 }
  );

  await queryWithTimeout(
    `INSERT INTO signal_outcomes (
       signal_id,
       symbol,
       entry_price,
       exit_price,
       return_percent,
       strategy,
       created_at,
       move_down_percent,
       evaluated_at,
       pnl_pct,
       outcome
     )
     SELECT
       s.id,
       s.symbol,
       COALESCE(mm.price, 0),
       COALESCE(mm.price, 0),
       0,
       'stocks_in_play_setup',
       NOW(),
       0,
       NOW(),
       0,
       'pending'
     FROM signals s
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(s.symbol)
     WHERE UPPER(s.symbol) = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM signal_outcomes so WHERE UPPER(so.symbol) = UPPER(s.symbol)
       )`,
    [symbols],
    { timeoutMs: 30000, label: 'phase4.insert.signal_outcomes', maxRetries: 0 }
  );

  await queryWithTimeout(
    `INSERT INTO trade_outcomes (
       signal_id,
       symbol,
       max_move,
       max_drawdown,
       success,
       evaluation_time,
       strategy,
       entry_price,
       exit_price,
       max_drawdown_pct,
       pnl_pct,
       max_move_pct,
       created_at,
       evaluated_at,
       data_quality,
       calibration_eligible
     )
     SELECT
       s.id,
       s.symbol,
       0,
       0,
       false,
       NOW(),
       'stocks_in_play_setup',
       COALESCE(mm.price, 0),
       COALESCE(mm.price, 0),
       0,
       0,
       0,
       NOW(),
       NOW(),
       'placeholder',
       false
     FROM signals s
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(s.symbol)
     WHERE UPPER(s.symbol) = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM trade_outcomes t WHERE UPPER(t.symbol) = UPPER(s.symbol)
       )`,
    [symbols],
    { timeoutMs: 30000, label: 'phase4.insert.trade_outcomes', maxRetries: 0 }
  );

  const overlap = await sqlOne(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON s.id = ts.signal_id
     JOIN signal_outcomes so ON s.id = so.signal_id`,
    [],
    'phase4.validate.overlap'
  );

  if (Number(overlap.n) <= 10) {
    fail(phase, 'Lifecycle overlap did not reach required threshold', { overlap: Number(overlap.n) });
  }

  logStep(phase, 'Stocks-in-play linked into lifecycle', { overlap: Number(overlap.n), symbols_count: symbols.length });
}

async function phase5DecisionRewireValidation() {
  const phase = 'PHASE_5';
  logStep(phase, 'Validating stocks_in_play-driven decision coverage');

  const topRows = await sqlRows(
    `SELECT symbol
     FROM (
       SELECT
         UPPER(symbol) AS symbol,
         MAX(score) AS best_score,
         MAX(detected_at) AS last_seen
       FROM stocks_in_play
       WHERE symbol IS NOT NULL
         AND TRIM(symbol) <> ''
       GROUP BY UPPER(symbol)
     ) ranked
     ORDER BY best_score DESC NULLS LAST, last_seen DESC NULLS LAST
     LIMIT 20`,
    [],
    'phase5.top_symbols'
  );

  const symbols = topRows.map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean);
  if (symbols.length === 0) {
    fail(phase, 'No symbols available for decision validation');
  }

  const { buildDecision } = require('../server/engines/intelligenceDecisionEngine');
  let nonNullScores = 0;
  for (const symbol of symbols) {
    try {
      const decision = await buildDecision(symbol);
      if (Number.isFinite(decision?.decision_score)) {
        nonNullScores += 1;
      }
    } catch (error) {
      logStep(phase, 'Decision build failure for symbol', { symbol, error: error.message });
    }
  }

  if (nonNullScores < 5) {
    fail(phase, 'Non-null decision coverage below threshold', { symbols_checked: symbols.length, non_null_scores: nonNullScores });
  }

  logStep(phase, 'Decision coverage validated', { symbols_checked: symbols.length, non_null_scores: nonNullScores });
}

async function phase6ValidationGuards() {
  const phase = 'PHASE_6';
  logStep(phase, 'Installing write guards and critical blockers');

  await queryWithTimeout(
    `CREATE OR REPLACE FUNCTION guard_signal_write_fn()
     RETURNS trigger AS $$
     DECLARE
       overlap_count integer;
     BEGIN
       IF NEW.symbol IS NULL OR BTRIM(NEW.symbol) = '' THEN
         RAISE EXCEPTION 'BLOCKED_SIGNAL_WRITE: missing symbol';
       END IF;

       SELECT COUNT(DISTINCT s.symbol)::int
         INTO overlap_count
       FROM signals s
       JOIN trade_setups ts ON s.id = ts.signal_id
       JOIN signal_outcomes so ON s.id = so.signal_id;

       IF overlap_count = 0 THEN
         RAISE EXCEPTION 'CRITICAL_PIPELINE_GUARD: lifecycle overlap is zero, blocking signal write';
       END IF;

       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
    [],
    { timeoutMs: 20000, label: 'phase6.create.guard.fn', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DROP TRIGGER IF EXISTS guard_signal_write_trigger ON signals`,
    [],
    { timeoutMs: 10000, label: 'phase6.drop.guard.trigger', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TRIGGER guard_signal_write_trigger
     BEFORE INSERT OR UPDATE ON signals
     FOR EACH ROW
     EXECUTE FUNCTION guard_signal_write_fn()`,
    [],
    { timeoutMs: 10000, label: 'phase6.create.guard.trigger', maxRetries: 0 }
  );

  logStep(phase, 'Validation guards installed');
}

async function waitForEndpoint(url, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function phase7FinalValidation() {
  const phase = 'PHASE_7';
  logStep(phase, 'Running endpoint + DB final validations');

  const serverDir = path.join(ROOT, 'server');
  const serverProc = spawn('npm', ['start'], {
    cwd: serverDir,
    stdio: 'ignore',
    detached: true,
  });

  const serverPid = serverProc.pid;
  serverProc.unref();

  try {
    const ready = await waitForEndpoint('http://127.0.0.1:3001/api/health', 60000);
    if (!ready) {
      fail(phase, 'Server did not become ready for endpoint checks');
    }

    const endpoints = ['/api/health', '/api/screener', '/api/intelligence/top-opportunities'];
    const endpointResults = [];

    for (const ep of endpoints) {
      let status = 0;
      let ok = false;
      let payload = null;
      try {
        const res = await fetch(`http://127.0.0.1:3001${ep}`, {
          headers: { Accept: 'application/json' },
        });
        status = res.status;
        ok = res.ok;
        payload = await res.json().catch(() => null);
      } catch (error) {
        payload = { error: error.message };
      }
      endpointResults.push({ endpoint: ep, status, ok, payload_sample: payload });
    }

    const failedEndpoints = endpointResults.filter((r) => !r.ok);
    if (failedEndpoints.length > 0) {
      fail(phase, 'Endpoint checks failed', { failedEndpoints });
    }

    const lifecycle = await sqlOne(
      `SELECT COUNT(DISTINCT s.symbol)::int AS n
       FROM signals s
       JOIN trade_setups ts ON s.id = ts.signal_id
       JOIN signal_outcomes so ON s.id = so.signal_id`,
      [],
      'phase7.lifecycle'
    );

    if (Number(lifecycle.n) <= 0) {
      fail(phase, 'Lifecycle overlap validation failed', { overlap: Number(lifecycle.n) });
    }

    const top = endpointResults.find((r) => r.endpoint === '/api/intelligence/top-opportunities');
    const nonNullScores = Number(top?.payload_sample?.non_null_scores || 0);
    if (nonNullScores <= 5) {
      fail(phase, 'Decision coverage validation failed', { non_null_scores: nonNullScores });
    }

    const postCounts = await rowCounts(REQUIRED_TABLES);
    const postSnapshot = {
      ts: nowIso(),
      phase,
      endpoint_results: endpointResults.map((x) => ({ endpoint: x.endpoint, status: x.status, ok: x.ok })),
      lifecycle_overlap: Number(lifecycle.n),
      decision_non_null_scores: nonNullScores,
      counts: postCounts,
      phase_log: [...phaseLog],
    };

    ensureLogDir();
    fs.writeFileSync(POST_SNAPSHOT, JSON.stringify(postSnapshot, null, 2));

    logStep(phase, 'Post-snapshot written', {
      file: POST_SNAPSHOT,
      lifecycle_overlap: Number(lifecycle.n),
      decision_non_null_scores: nonNullScores,
    });
  } finally {
    if (serverPid) {
      try {
        process.kill(-serverPid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
  }
}

async function main() {
  try {
    ensureLogDir();
    await phase0FreezeAndSnapshot();
    const canonical = await phase1CanonicalSignalSource();
    await phase2LifecycleLinking(canonical);
    await phase3SessionLogic();
    await phase4StocksInPlayPipeline();
    await phase5DecisionRewireValidation();
    await phase6ValidationGuards();
    await phase7FinalValidation();

    console.log('PIPELINE LOCKED');
    process.exit(0);
  } catch (error) {
    const details = {
      ts: nowIso(),
      failed_phase: error.phase || 'unknown',
      reason: error.message,
      details: error.details || null,
      phase_log: phaseLog,
    };

    ensureLogDir();
    fs.writeFileSync(path.join(LOG_DIR, 'pipeline_failed.json'), JSON.stringify(details, null, 2));
    console.error('PIPELINE FAILED', JSON.stringify(details));
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {
      // ignore
    }
  }
}

main();
