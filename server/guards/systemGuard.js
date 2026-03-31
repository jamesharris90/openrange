const { queryWithTimeout } = require('../db/pg');

// ── Pipeline health thresholds ───────────────────────────────────────────────
const MIN_QUOTES_ROWS   = 100;   // market_quotes must have at least 100 symbols
const MIN_INTRADAY_ROWS = 1000;  // intraday_1m needs meaningful candle history
const MIN_DAILY_ROWS    = 1000;  // daily_ohlc needs meaningful history

async function checkDataPipelineHealth() {
  let quotes = 0, intraday = 0, daily = 0;

  try {
    // Use pg_class approximate counts for large tables (intraday_1m, daily_ohlc
    // can have millions of rows — COUNT(*) times out under pool pressure).
    const [qRes, iRes, dRes] = await Promise.all([
      queryWithTimeout(
        `SELECT COUNT(*)::int AS count FROM market_quotes`,
        [], { timeoutMs: 5000, label: 'pipeline_guard.quotes', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT GREATEST(reltuples::int, 0) AS count FROM pg_class WHERE relname = 'intraday_1m'`,
        [], { timeoutMs: 3000, label: 'pipeline_guard.intraday', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT GREATEST(reltuples::int, 0) AS count FROM pg_class WHERE relname = 'daily_ohlc'`,
        [], { timeoutMs: 3000, label: 'pipeline_guard.daily', maxRetries: 0 }
      ),
    ]);
    quotes   = Number(qRes.rows?.[0]?.count  || 0);
    intraday = Number(iRes.rows?.[0]?.count  || 0);
    daily    = Number(dRes.rows?.[0]?.count  || 0);
  } catch (err) {
    console.warn('[PIPELINE_GUARD] count queries failed:', err.message);
    // Can't verify — do not block on transient DB errors
    return true;
  }

  const healthy =
    quotes   >= MIN_QUOTES_ROWS &&
    intraday >= MIN_INTRADAY_ROWS &&
    daily    >= MIN_DAILY_ROWS;

  if (!healthy) {
    // Distinguish daily_ohlc=0 as its own reason so recovery can target it specifically
    const reason = daily === 0 ? 'daily_data_missing' : 'data_pipeline_empty';
    global.systemBlocked       = true;
    global.systemBlockedReason = reason;
    global.systemBlockedAt     = global.systemBlockedAt || new Date().toISOString();
    global.pipelineHealth      = { quotes, intraday, daily, blockedAt: global.systemBlockedAt };
    console.error('[PIPELINE_GUARD] CRITICAL: data pipeline below threshold — writes blocked', {
      quotes, intraday, daily,
      min_quotes: MIN_QUOTES_ROWS, min_intraday: MIN_INTRADAY_ROWS, min_daily: MIN_DAILY_ROWS,
      reason,
    });
  } else {
    global.pipelineHealth = { quotes, intraday, daily, blockedAt: null };
    const prevReason = global.systemBlockedReason;
    if (prevReason === 'data_pipeline_empty' || prevReason === 'daily_data_missing') {
      global.systemBlocked       = false;
      global.systemBlockedReason = null;
      global.systemBlockedAt     = null;
      console.log('[PIPELINE_GUARD] pipeline restored — block cleared', { quotes, intraday, daily });
    }
  }

  return healthy;
}

function isActiveSession() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const minutes = (hour * 60) + minute;

  const marketOpen = (9 * 60) + 30;
  const marketClose = 16 * 60;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  return isWeekday && minutes >= marketOpen && minutes <= marketClose;
}

async function checkLifecycleOverlap() {
  // First check if signal_outcomes has any rows at all.
  // An empty table is a bootstrap state — blocking writes would prevent it from ever
  // being populated (deadlock). Only block if the table has rows but overlap is still 0,
  // which would indicate real data corruption.
  let soCount = 0;
  try {
    const soResult = await queryWithTimeout(
      `SELECT COUNT(*)::int AS n FROM signal_outcomes`,
      [],
      { timeoutMs: 5000, label: 'system_guard.signal_outcomes_count', maxRetries: 0 }
    );
    soCount = Number(soResult.rows?.[0]?.n || 0);
  } catch (err) {
    console.warn('[SYSTEM_GUARD] could not count signal_outcomes, skipping overlap check', err.message);
    return 0;
  }

  if (soCount === 0) {
    // Bootstrap state: no signal_outcomes exist yet — allow writes so the table can be seeded
    if (global.systemBlocked && global.systemBlockedReason === 'lifecycle_overlap_zero') {
      global.systemBlocked = false;
      global.systemBlockedReason = null;
      global.systemBlockedAt = null;
      console.log('[SYSTEM_GUARD] lifecycle overlap check: bootstrap state (signal_outcomes empty) — writes unblocked');
    } else {
      console.log('[SYSTEM_GUARD] lifecycle overlap check: bootstrap state (signal_outcomes empty) — skipping block');
    }
    return 0;
  }

  // Overlap check: verify signal pipeline activity end-to-end.
  // signal_outcomes now uses the new schema (029_signal_outcomes.sql) which does NOT have
  // signal_id — match by symbol instead, checking that both tables have recent activity
  // for the same symbols.
  let overlap;
  try {
    const overlapRes = await queryWithTimeout(
      `SELECT COUNT(DISTINCT so.symbol)::int AS n
       FROM signal_outcomes so
       WHERE so.symbol IN (SELECT DISTINCT symbol FROM trade_setups WHERE updated_at > NOW() - INTERVAL '7 days')
         AND so.created_at > NOW() - INTERVAL '7 days'`,
      [],
      { timeoutMs: 10000, label: 'system_guard.lifecycle_overlap', maxRetries: 0 }
    );
    overlap = Number(overlapRes.rows?.[0]?.n || 0);
  } catch (err) {
    console.warn('[SYSTEM_GUARD] lifecycle overlap query failed, skipping block check', err.message);
    return 0;
  }

  console.log('[SYSTEM_GUARD] lifecycle overlap', overlap, { signal_outcomes_rows: soCount });

  if (overlap === 0) {
    // Only block if signal_outcomes has rows AND trade_setups has recent rows — indicates real data gap
    let recentSetups = 0;
    try {
      const setupRes = await queryWithTimeout(
        `SELECT COUNT(*)::int AS n FROM trade_setups WHERE updated_at > NOW() - INTERVAL '7 days'`,
        [],
        { timeoutMs: 5000, label: 'system_guard.trade_setups_count', maxRetries: 0 }
      );
      recentSetups = Number(setupRes.rows?.[0]?.n || 0);
    } catch (_e) {
      // ignore
    }

    if (recentSetups > 0) {
      global.systemBlocked = true;
      global.systemBlockedReason = 'lifecycle_overlap_zero';
      global.systemBlockedAt = new Date().toISOString();
      console.error('[SYSTEM_GUARD] CRITICAL overlap=0 (signal_outcomes and trade_setups active but no shared symbols), writes blocked');
    } else {
      console.log('[SYSTEM_GUARD] lifecycle overlap=0 but no recent trade_setups — pipeline not yet active, not blocking');
    }
  }

  return overlap;
}

async function checkDecisionNullRate() {
  const rows = await queryWithTimeout(
    `SELECT symbol
     FROM (
       SELECT UPPER(symbol) AS symbol, MAX(score) AS best_score, MAX(detected_at) AS last_seen
       FROM stocks_in_play
       WHERE symbol IS NOT NULL AND TRIM(symbol) <> ''
       GROUP BY UPPER(symbol)
     ) ranked
     ORDER BY best_score DESC NULLS LAST, last_seen DESC NULLS LAST
     LIMIT 20`,
    [],
    { timeoutMs: 10000, label: 'system_guard.decision_rows', maxRetries: 0 }
  );

  const symbols = (rows.rows || []).map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean);
  if (symbols.length === 0) {
    console.warn('[SYSTEM_GUARD] decision null-rate check skipped (no symbols)');
    return { symbols: 0, nullRate: 1 };
  }

  const { buildDecision } = require('../engines/intelligenceDecisionEngine');
  let nonNullScores = 0;

  for (const symbol of symbols) {
    try {
      const decision = await buildDecision(symbol);
      if (Number.isFinite(Number(decision?.decision_score))) {
        nonNullScores += 1;
      }
    } catch (error) {
      console.warn('[SYSTEM_GUARD] decision build error', { symbol, error: error.message });
    }
  }

  const nullRate = (symbols.length - nonNullScores) / symbols.length;
  console.log('[SYSTEM_GUARD] decision coverage', {
    total: symbols.length,
    non_null_scores: nonNullScores,
    null_rate_percent: Number((nullRate * 100).toFixed(2)),
  });

  if (nullRate > 0.7) {
    console.warn('[SYSTEM_GUARD] WARNING decision null rate above 70%');
  }

  return { symbols: symbols.length, nullRate };
}

async function checkSignalsFlow() {
  const activeSession = isActiveSession();
  const recentSignals = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'system_guard.signals_recent', maxRetries: 0 }
  );

  const count = Number(recentSignals.rows?.[0]?.n || 0);
  console.log('[SYSTEM_GUARD] signals recent', { active_session: activeSession, signals_recent: count });

  if (activeSession && count === 0) {
    console.warn('[SYSTEM_GUARD] ALERT signals_created=0 during active session');
  }

  return { activeSession, count };
}

async function checkLiveDataFlow() {
  const market = await queryWithTimeout(
    `SELECT MAX(updated_at) AS max_updated_at FROM market_metrics`,
    [],
    { timeoutMs: 10000, label: 'system_guard.market_metrics_freshness', maxRetries: 0 }
  );
  const stocks = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM stocks_in_play
     WHERE detected_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'system_guard.stocks_in_play_recent', maxRetries: 0 }
  );

  const maxUpdatedAt = market.rows?.[0]?.max_updated_at ? new Date(market.rows[0].max_updated_at) : null;
  const marketFresh = Boolean(maxUpdatedAt) && ((Date.now() - maxUpdatedAt.getTime()) <= (5 * 60 * 1000));
  const stocksRecent = Number(stocks.rows?.[0]?.n || 0);

  return {
    marketFresh,
    marketUpdatedAt: maxUpdatedAt ? maxUpdatedAt.toISOString() : null,
    stocksRecent,
  };
}

async function systemGuard() {
  if (global.systemGuardInFlight) {
    console.log('[SYSTEM_GUARD] run skipped (already in flight)');
    return;
  }

  global.systemGuardInFlight = true;
  if (typeof global.systemBlocked !== 'boolean') {
    global.systemBlocked = false;
  }

  try {
    console.log('[SYSTEM_GUARD] run started', { blocked: global.systemBlocked, reason: global.systemBlockedReason || null });

    // Pipeline health is checked first — if empty, no point running other checks
    const pipelineHealthy = await checkDataPipelineHealth();
    if (!pipelineHealthy) {
      console.warn('[SYSTEM_GUARD] pipeline unhealthy — skipping further checks this cycle');
      return;
    }

    const lifecycleOverlap = await checkLifecycleOverlap();
    const decision = await checkDecisionNullRate();
    const signals = await checkSignalsFlow();
    const liveData = await checkLiveDataFlow();

    if (signals.count === 0 || liveData.stocksRecent === 0 || !liveData.marketFresh) {
      console.error('SYSTEM_DATA_FLOW_STOPPED', {
        signals_recent: signals.count,
        stocks_in_play_recent: liveData.stocksRecent,
        market_metrics_fresh: liveData.marketFresh,
        market_metrics_updated_at: liveData.marketUpdatedAt,
      });
    }

    console.log('[SYSTEM_GUARD] run complete', {
      lifecycle_overlap: lifecycleOverlap,
      decision_null_rate: Number((decision.nullRate * 100).toFixed(2)),
      signals_recent: signals.count,
      stocks_in_play_recent: liveData.stocksRecent,
      market_metrics_fresh: liveData.marketFresh,
      blocked: global.systemBlocked,
    });
  } catch (error) {
    console.error('[SYSTEM_GUARD] run failed', error.message);
  } finally {
    global.systemGuardInFlight = false;
  }
}

module.exports = { systemGuard, checkDataPipelineHealth };
