const express = require('express');

const { queryWithTimeout } = require('../../db/pg');

const router = express.Router();

const CACHE_TTL_MS = 60 * 1000;
const responseCache = new Map();

const STRATEGY_LOOKUP = {
  breakout_consolidation: { strategy_name: 'Breakout Consolidation', category: 'momentum' },
  earnings_drift_long: { strategy_name: 'Earnings Drift Long', category: 'earnings' },
  earnings_gap_continuation: { strategy_name: 'Earnings Gap Continuation', category: 'earnings' },
  gap_and_go_long: { strategy_name: 'Gap-and-Go Long', category: 'momentum' },
  golden_cross_momentum: { strategy_name: 'Golden Cross Momentum', category: 'trend' },
  ma_bounce_50sma: { strategy_name: '50 SMA Bounce', category: 'mean_reversion' },
  news_momentum_breakout: { strategy_name: 'News Momentum Breakout', category: 'news' },
  orb_long_breakout: { strategy_name: 'ORB Long Breakout', category: 'momentum' },
  orb_short_breakdown: { strategy_name: 'ORB Short Breakdown', category: 'momentum' },
  oversold_bounce_hammer: { strategy_name: 'Oversold Hammer Bounce', category: 'mean_reversion' },
  red_to_green_long: { strategy_name: 'Red-to-Green Long', category: 'momentum' },
  trend_reversal_higher_low: { strategy_name: 'Trend Reversal Higher Low', category: 'reversal' },
  volume_climax_reversal: { strategy_name: 'Volume Climax Reversal', category: 'reversal' },
  vwap_mean_revert_short: { strategy_name: 'VWAP Mean Revert Short', category: 'mean_reversion' },
  vwap_reclaim_long: { strategy_name: 'VWAP Reclaim Long', category: 'momentum' },
};

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isoDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function toIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeDirection(value) {
  const text = String(value || '').trim().toUpperCase();
  if (text === 'LONG' || text === 'SHORT') {
    return text;
  }
  return text || null;
}

function nextUpdateUtc(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(6, 15, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

function getStrategyMeta(strategyId) {
  return STRATEGY_LOOKUP[strategyId] || {
    strategy_name: String(strategyId || '').replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()),
    category: 'system',
  };
}

function deriveTrend(currentWinRate, previousWinRate) {
  if (!Number.isFinite(previousWinRate)) {
    return 'new';
  }

  const delta = currentWinRate - previousWinRate;
  if (delta >= 0.02) {
    return 'improving';
  }
  if (delta <= -0.02) {
    return 'declining';
  }
  return 'stable';
}

function deriveOutcome(row) {
  const pnlR = toNumber(row?.pnl_r);
  if (pnlR == null) {
    return 'open';
  }
  if (pnlR > 0) {
    return 'win';
  }
  if (pnlR < 0) {
    return 'loss';
  }
  return 'open';
}

function getCachedPayload(key) {
  const cached = responseCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }

  return cached.payload;
}

function setCachedPayload(key, payload) {
  responseCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  });
}

async function sendCached(req, res, builder) {
  const cacheKey = req.originalUrl || req.url;
  const cached = getCachedPayload(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const payload = await builder();
  setCachedPayload(cacheKey, payload);
  return res.json(payload);
}

async function queryRows(label, sql, params = [], timeoutMs = 15000) {
  const result = await queryWithTimeout(sql, params, {
    timeoutMs,
    label,
    maxRetries: 0,
  });
  return result.rows || [];
}

async function getLatestScoreContext() {
  const rows = await queryRows(
    'beacon.latest_score_context',
    `SELECT
       MAX(score_date) AS latest_any_score_date
     FROM strategy_scores`
  );

  const row = rows[0] || {};
  return {
    latestAnyScoreDate: isoDate(row.latest_any_score_date),
  };
}

async function getNightlyTablesExist() {
  const rows = await queryRows(
    'beacon.nightly.tables_exist',
    `SELECT
       to_regclass('public.beacon_nightly_runs')::text AS runs_table,
       to_regclass('public.beacon_pick_outcomes')::text AS outcomes_table,
       to_regclass('public.beacon_strategy_params')::text AS params_table`,
    []
  );

  const row = rows[0] || {};
  return Boolean(row.runs_table && row.outcomes_table && row.params_table);
}

router.get('/summary', async (req, res) => {
  try {
    return await sendCached(req, res, async () => {
      const context = await getLatestScoreContext();
      const latestScoreDate = context.latestAnyScoreDate;
      const [summaryRows] = await Promise.all([
        queryRows(
          'beacon.summary.metrics',
          `WITH ranked_scores AS (
             SELECT
               strategy_id,
               win_rate,
               total_signals,
               ROW_NUMBER() OVER (
                 PARTITION BY strategy_id
                 ORDER BY score_date DESC, created_at DESC
               ) AS rn
             FROM strategy_scores
             WHERE lookback_days = 30
           ),
           latest_scores AS (
             SELECT strategy_id, win_rate, total_signals
             FROM ranked_scores
             WHERE rn = 1
           )
           SELECT
             (SELECT COUNT(DISTINCT strategy_id) FROM latest_scores) AS active_strategies,
             (SELECT COUNT(*) FROM strategy_backtest_signals) AS signals_tracked,
             (SELECT COUNT(*)
              FROM beacon_v0_picks
              WHERE run_id = (
                SELECT run_id
                FROM beacon_v0_picks
                ORDER BY created_at DESC
                LIMIT 1
                )) AS todays_picks,
             (SELECT CASE
               WHEN COALESCE(SUM(total_signals), 0) = 0 THEN NULL
               ELSE SUM(win_rate * total_signals) / SUM(total_signals)
             END FROM latest_scores) AS weighted_win_rate`,
          [],
          30000
        ),
      ]);

      const summary = summaryRows[0] || {};
      return {
        active_strategies: toNumber(summary.active_strategies, 0),
        signals_tracked: toNumber(summary.signals_tracked, 0),
        todays_picks: toNumber(summary.todays_picks, 0),
        thirty_day_win_rate: toNumber(summary.weighted_win_rate) != null
          ? Number((toNumber(summary.weighted_win_rate, 0) * 100).toFixed(1))
          : null,
        latest_score_date: latestScoreDate,
        next_update_utc: nextUpdateUtc(),
      };
    });
  } catch (error) {
    return res.status(500).json({ error: 'beacon_summary_failed', message: error.message });
  }
});

router.get('/picks', async (req, res) => {
  try {
    return await sendCached(req, res, async () => {
      const requestedDate = isoDate(req.query.date) || isoDate(new Date());
      const context = await getLatestScoreContext();
      const latestScoreDate = context.latestAnyScoreDate;

      const rows = await queryRows(
        'beacon.picks',
        `WITH ranked_scores AS (
           SELECT
             strategy_id,
             grade,
             win_rate,
             profit_factor,
             ROW_NUMBER() OVER (
               PARTITION BY strategy_id
               ORDER BY score_date DESC, created_at DESC
             ) AS rn
           FROM strategy_scores
           WHERE lookback_days = 30
         ),
         latest_scores AS (
           SELECT strategy_id, grade, win_rate, profit_factor
           FROM ranked_scores
           WHERE rn = 1
         )
         SELECT
           mp.rank,
           mp.symbol,
           mp.strategy_id,
           mp.direction,
           mp.entry_price,
           mp.stop_price,
           mp.target_price,
           mp.confidence_score,
           mp.strategy_grade AS pick_strategy_grade,
           mp.strategy_win_rate AS pick_strategy_win_rate,
           ls.grade AS latest_grade,
           ls.win_rate AS latest_win_rate,
           ls.profit_factor AS latest_profit_factor,
           mq.price AS current_price,
           mq.change_percent,
           COALESCE(cp.sector, tu.sector, mq.sector) AS sector,
           COALESCE(cp.company_name, tu.company_name) AS company_name,
           mp.created_at
         FROM morning_picks mp
         LEFT JOIN latest_scores ls
           ON ls.strategy_id = mp.strategy_id
         LEFT JOIN market_quotes mq
           ON mq.symbol = mp.symbol
         LEFT JOIN ticker_universe tu
           ON tu.symbol = mp.symbol
         LEFT JOIN company_profiles cp
           ON cp.symbol = mp.symbol
         WHERE mp.pick_date = $1::date
         ORDER BY mp.rank ASC NULLS LAST, mp.symbol ASC`,
        [requestedDate],
        30000
      );

      const generatedAt = rows.reduce((latest, row) => {
        const timestamp = toIsoTimestamp(row.created_at);
        if (!timestamp) {
          return latest;
        }
        return !latest || timestamp > latest ? timestamp : latest;
      }, null);

      return {
        pick_date: requestedDate,
        generated_at: generatedAt,
        picks: rows.map((row) => {
          const meta = getStrategyMeta(row.strategy_id);
          return {
            rank: toNumber(row.rank),
            symbol: row.symbol,
            strategy_id: row.strategy_id,
            strategy_name: meta.strategy_name,
            direction: normalizeDirection(row.direction),
            entry_price: toNumber(row.entry_price),
            stop_price: toNumber(row.stop_price),
            target_price: toNumber(row.target_price),
            confidence_score: toNumber(row.confidence_score),
            strategy_grade: row.latest_grade || row.pick_strategy_grade || null,
            strategy_win_rate: toNumber(row.latest_win_rate) != null
              ? Number((toNumber(row.latest_win_rate, 0) * 100).toFixed(1))
              : toNumber(row.pick_strategy_win_rate),
            strategy_profit_factor: toNumber(row.latest_profit_factor),
            current_price: toNumber(row.current_price),
            change_percent: toNumber(row.change_percent),
            sector: row.sector || null,
          };
        }),
      };
    });
  } catch (error) {
    return res.status(500).json({ error: 'beacon_picks_failed', message: error.message });
  }
});

router.get('/strategies', async (req, res) => {
  try {
    return await sendCached(req, res, async () => {
      const context = await getLatestScoreContext();
      const latestScoreDate = context.latestAnyScoreDate;

      const rows = await queryRows(
        'beacon.strategies',
        `WITH ranked_scores AS (
           SELECT
             strategy_id,
             grade,
             win_rate,
             profit_factor,
             total_signals,
             avg_pnl_r,
             lookback_days,
             created_at,
             score_date,
             ROW_NUMBER() OVER (
               PARTITION BY strategy_id
               ORDER BY score_date DESC, created_at DESC
             ) AS rn,
             LEAD(win_rate) OVER (
               PARTITION BY strategy_id
               ORDER BY score_date DESC, created_at DESC
             ) AS previous_win_rate
           FROM strategy_scores
           WHERE lookback_days = 30
         ),
         latest_scores AS (
           SELECT *
           FROM ranked_scores
           WHERE rn = 1
         )
         SELECT
           ls.strategy_id,
           ls.grade,
           ls.win_rate,
           ls.profit_factor,
           ls.total_signals,
           ls.avg_pnl_r,
           ls.lookback_days,
           ls.created_at,
           ls.previous_win_rate
         FROM latest_scores ls
         ORDER BY
           CASE ls.grade
             WHEN 'A' THEN 1
             WHEN 'B' THEN 2
             WHEN 'C' THEN 3
             WHEN 'D' THEN 4
             ELSE 5
           END,
           ls.win_rate DESC,
           ls.strategy_id ASC`,
        [],
        30000
      );

      const scoredAt = rows.reduce((latest, row) => {
        const timestamp = toIsoTimestamp(row.created_at);
        if (!timestamp) {
          return latest;
        }
        return !latest || timestamp > latest ? timestamp : latest;
      }, null);

      return {
        scored_at: scoredAt,
        strategies: rows.map((row) => {
          const meta = getStrategyMeta(row.strategy_id);
          const currentWinRate = toNumber(row.win_rate, 0);
          const previousWinRate = toNumber(row.previous_win_rate);
          const totalSignals = toNumber(row.total_signals, 0);
          const avgPnlR = toNumber(row.avg_pnl_r, 0);
          return {
            strategy_id: row.strategy_id,
            strategy_name: meta.strategy_name,
            category: meta.category,
            grade: row.grade,
            win_rate: Number((currentWinRate * 100).toFixed(1)),
            profit_factor: toNumber(row.profit_factor),
            total_signals: totalSignals,
            avg_r_multiple: Number(avgPnlR.toFixed(2)),
            lookback_days: toNumber(row.lookback_days),
            thirty_day_pnl_r: Number((avgPnlR * totalSignals).toFixed(1)),
            trend: deriveTrend(currentWinRate, previousWinRate),
          };
        }),
      };
    });
  } catch (error) {
    return res.status(500).json({ error: 'beacon_strategies_failed', message: error.message });
  }
});

router.get('/track-record', async (req, res) => {
  try {
    return await sendCached(req, res, async () => {
      const requestedDays = Math.max(1, Math.min(365, toNumber(req.query.days, 30)));
      const strategyFilter = String(req.query.strategy_id || '').trim() || null;
      const params = [requestedDays];
      const strategyWhere = strategyFilter ? 'AND strategy_id = $2' : '';
      if (strategyFilter) {
        params.push(strategyFilter);
      }

      const rows = await queryRows(
        'beacon.track_record.rows',
        `SELECT
           strategy_id,
           symbol,
           signal_date,
           direction,
           entry_price,
           stop_price,
           target_price,
           exit_price,
           exit_reason,
           pnl_r,
           created_at
         FROM strategy_backtest_signals
         WHERE signal_date >= CURRENT_DATE - ($1::int || ' days')::interval
           ${strategyWhere}
         ORDER BY signal_date DESC, created_at DESC`,
        params,
        30000
      );

      const closedRows = rows.filter((row) => toNumber(row.pnl_r) != null);
      const wins = closedRows.filter((row) => toNumber(row.pnl_r, 0) > 0);
      const losses = closedRows.filter((row) => toNumber(row.pnl_r, 0) < 0);
      const totalPositiveR = wins.reduce((sum, row) => sum + toNumber(row.pnl_r, 0), 0);
      const totalNegativeR = losses.reduce((sum, row) => sum + Math.abs(toNumber(row.pnl_r, 0)), 0);
      const dailyMap = new Map();

      for (const row of closedRows) {
        const date = isoDate(row.signal_date);
        if (!date) {
          continue;
        }
        dailyMap.set(date, (dailyMap.get(date) || 0) + toNumber(row.pnl_r, 0));
      }

      let cumulative = 0;
      const equityCurve = Array.from(dailyMap.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, value]) => {
          cumulative += value;
          return {
            date,
            cumulative_r: Number(cumulative.toFixed(2)),
          };
        });

      return {
        window_days: requestedDays,
        strategy_filter: strategyFilter,
        total_picks: closedRows.length,
        wins: wins.length,
        losses: losses.length,
        win_rate: closedRows.length > 0 ? Number(((wins.length / closedRows.length) * 100).toFixed(1)) : 0,
        avg_winner_r: wins.length > 0 ? Number((totalPositiveR / wins.length).toFixed(2)) : 0,
        avg_loser_r: losses.length > 0 ? Number((losses.reduce((sum, row) => sum + toNumber(row.pnl_r, 0), 0) / losses.length).toFixed(2)) : 0,
        profit_factor: totalNegativeR > 0 ? Number((totalPositiveR / totalNegativeR).toFixed(2)) : null,
        equity_curve: [{ date: isoDate(new Date(Date.now() - requestedDays * 24 * 60 * 60 * 1000)), cumulative_r: 0 }, ...equityCurve],
        recent_picks: rows.slice(0, 50).map((row) => ({
          pick_date: isoDate(row.signal_date),
          symbol: row.symbol,
          strategy_id: row.strategy_id,
          direction: normalizeDirection(row.direction),
          entry_price: toNumber(row.entry_price),
          stop_price: toNumber(row.stop_price),
          target_price: toNumber(row.target_price),
          outcome: deriveOutcome(row),
          exit_price: toNumber(row.exit_price),
          r_multiple: toNumber(row.pnl_r),
          exit_date: null,
        })),
      };
    });
  } catch (error) {
    return res.status(500).json({ error: 'beacon_track_record_failed', message: error.message });
  }
});

router.get('/nightly-status', async (req, res) => {
  try {
    return await sendCached(req, res, async () => {
      const nightlyReady = await getNightlyTablesExist();
      if (!nightlyReady) {
        return {
          configured: false,
          last_run: null,
          pending_outcomes: 0,
          recent_outcomes: {
            evaluated_count: 0,
            wins: 0,
            losses: 0,
            flats: 0,
            avg_r: null,
            win_rate: null,
          },
          strategy_params: [],
          recent_runs: [],
        };
      }

      const [lastRunRows, pendingRows, outcomesRows, paramsRows, recentRunRows] = await Promise.all([
        queryRows(
          'beacon.nightly.last_run',
          `SELECT id, status, started_at, completed_at, evaluated_pick_count, tuned_strategy_count,
                  generated_pick_count, score_rows, signal_rows, error, metadata
           FROM beacon_nightly_runs
           ORDER BY started_at DESC
           LIMIT 1`
        ),
        queryRows(
          'beacon.nightly.pending_outcomes',
          `SELECT COUNT(*)::int AS pending_count
           FROM morning_picks
           WHERE outcome IS NULL OR outcome IN ('pending', 'open') OR actual_pnl_r IS NULL`
        ),
        queryRows(
          'beacon.nightly.recent_outcomes',
          `SELECT
             COUNT(*)::int AS evaluated_count,
             COUNT(*) FILTER (WHERE evaluation_status = 'win')::int AS wins,
             COUNT(*) FILTER (WHERE evaluation_status = 'loss')::int AS losses,
             COUNT(*) FILTER (WHERE evaluation_status = 'flat')::int AS flats,
             AVG(actual_pnl_r)::numeric AS avg_r
           FROM beacon_pick_outcomes
           WHERE evaluated_at >= NOW() - INTERVAL '30 days'`
        ),
        queryRows(
          'beacon.nightly.strategy_params',
          `SELECT strategy_id, enabled, min_grade_score, min_win_rate, min_profit_factor,
                  confidence_multiplier, max_picks_per_run, hold_days, evaluation_lookback,
                  updated_at, metadata
           FROM beacon_strategy_params
           ORDER BY strategy_id ASC`
        ),
        queryRows(
          'beacon.nightly.recent_runs',
          `SELECT id, status, started_at, completed_at, evaluated_pick_count, tuned_strategy_count,
                  generated_pick_count, score_rows, signal_rows, error
           FROM beacon_nightly_runs
           ORDER BY started_at DESC
           LIMIT 5`
        ),
      ]);

      const lastRun = lastRunRows[0] || null;
      const recent = outcomesRows[0] || {};
      const evaluatedCount = toNumber(recent.evaluated_count, 0);
      const wins = toNumber(recent.wins, 0);

      return {
        configured: true,
        last_run: lastRun ? {
          id: toNumber(lastRun.id),
          status: lastRun.status || null,
          started_at: toIsoTimestamp(lastRun.started_at),
          completed_at: toIsoTimestamp(lastRun.completed_at),
          evaluated_pick_count: toNumber(lastRun.evaluated_pick_count, 0),
          tuned_strategy_count: toNumber(lastRun.tuned_strategy_count, 0),
          generated_pick_count: toNumber(lastRun.generated_pick_count, 0),
          score_rows: toNumber(lastRun.score_rows, 0),
          signal_rows: toNumber(lastRun.signal_rows, 0),
          error: lastRun.error || null,
          metadata: lastRun.metadata || {},
        } : null,
        pending_outcomes: toNumber(pendingRows[0]?.pending_count, 0),
        recent_outcomes: {
          evaluated_count: evaluatedCount,
          wins,
          losses: toNumber(recent.losses, 0),
          flats: toNumber(recent.flats, 0),
          avg_r: toNumber(recent.avg_r),
          win_rate: evaluatedCount > 0 ? Number(((wins / evaluatedCount) * 100).toFixed(1)) : null,
        },
        strategy_params: paramsRows.map((row) => ({
          strategy_id: row.strategy_id,
          strategy_name: getStrategyMeta(row.strategy_id).strategy_name,
          enabled: row.enabled !== false,
          min_grade_score: toNumber(row.min_grade_score, 0),
          min_win_rate: toNumber(row.min_win_rate),
          min_profit_factor: toNumber(row.min_profit_factor),
          confidence_multiplier: toNumber(row.confidence_multiplier, 1),
          max_picks_per_run: toNumber(row.max_picks_per_run, 0),
          hold_days: toNumber(row.hold_days, 1),
          evaluation_lookback: toNumber(row.evaluation_lookback, 0),
          updated_at: toIsoTimestamp(row.updated_at),
          metadata: row.metadata || {},
        })),
        recent_runs: recentRunRows.map((row) => ({
          id: toNumber(row.id),
          status: row.status || null,
          started_at: toIsoTimestamp(row.started_at),
          completed_at: toIsoTimestamp(row.completed_at),
          evaluated_pick_count: toNumber(row.evaluated_pick_count, 0),
          tuned_strategy_count: toNumber(row.tuned_strategy_count, 0),
          generated_pick_count: toNumber(row.generated_pick_count, 0),
          score_rows: toNumber(row.score_rows, 0),
          signal_rows: toNumber(row.signal_rows, 0),
          error: row.error || null,
        })),
      };
    });
  } catch (error) {
    return res.status(500).json({ error: 'beacon_nightly_status_failed', message: error.message });
  }
});

module.exports = router;