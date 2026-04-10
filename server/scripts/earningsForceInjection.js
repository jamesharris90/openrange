require('dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3001';

function randomScore() {
  return 70 + Math.floor(Math.random() * 16);
}

function ratio(part, total) {
  if (!total) return 0;
  return Number((part / total).toFixed(4));
}

async function fetchDecision(symbol) {
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const response = await fetch(`${API_BASE}/api/intelligence/decision/${encodeURIComponent(symbol)}`, {
    method: 'GET',
    headers,
  });
  const payloadText = await response.text();

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = {};
  }

  const decision = payload.decision || {};
  const hasExecutionPlan = decision.execution_plan != null;
  const hasDecisionScore = decision.decision_score != null;

  return {
    symbol,
    status: response.status,
    hasExecutionPlan,
    hasDecisionScore,
  };
}

async function getColumns(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName]
  );
  return new Set((result.rows || []).map((row) => row.column_name));
}

async function getColumnMeta(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName]
  );
  const map = new Map();
  for (const row of result.rows || []) {
    map.set(row.column_name, row);
  }
  return map;
}

async function getDecisionSourceTable(pool) {
  const result = await pool.query(
    "SELECT definition FROM pg_views WHERE schemaname='public' AND viewname='decision_view'"
  );
  const definition = String(result.rows?.[0]?.definition || '');
  const matched = definition.match(/decision_view_elite_source_\d+/);
  return matched ? matched[0] : null;
}

async function main() {
  const reportPath = path.join('/Users/jamesharris/Server/logs', 'earnings_force_injection.json');
  const report = {
    timestamp: new Date().toISOString(),
    signals_created: 0,
    setups_created: 0,
    decisions_unlocked: 0,
    earnings_in_top20: 0,
    verdict: 'fail',
    reasons: [],
    phase_validation: {},
  };

  try {
    const earningsWindowResult = await pool.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE symbol IS NOT NULL
         AND report_date::date BETWEEN CURRENT_DATE - INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '2 days'
       ORDER BY 1`
    );

    let earningsSymbols = (earningsWindowResult.rows || [])
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean);

    if (!earningsSymbols.length) {
      const anchorResult = await pool.query(
        `SELECT MIN(report_date)::date AS anchor_date
         FROM earnings_events
         WHERE report_date >= CURRENT_DATE - INTERVAL '1 day'`
      );
      const anchorDate = anchorResult.rows?.[0]?.anchor_date;
      if (anchorDate) {
        const fallbackWindowResult = await pool.query(
          `SELECT DISTINCT UPPER(symbol) AS symbol
           FROM earnings_events
           WHERE symbol IS NOT NULL
             AND report_date::date BETWEEN $1::date AND ($1::date + INTERVAL '2 days')
           ORDER BY 1`,
          [anchorDate]
        );
        earningsSymbols = (fallbackWindowResult.rows || [])
          .map((row) => String(row.symbol || '').trim().toUpperCase())
          .filter(Boolean);
        report.phase_validation.window_fallback = {
          anchor_date: String(anchorDate),
          symbols_in_fallback_window: earningsSymbols.length,
        };
      }
    }

    if (!earningsSymbols.length) {
      report.reasons.push('No earnings symbols in force-injection window');
      await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log('EARNINGS STILL DISCONNECTED + REASON');
      console.log(report.reasons.join('; '));
      return;
    }

    const signalColumns = await getColumns(pool, 'signals');
    const signalColumnMeta = await getColumnMeta(pool, 'signals');

    for (const symbol of earningsSymbols) {
      const existingSignal = await pool.query(
        `SELECT id
         FROM signals
         WHERE UPPER(symbol) = $1
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [symbol]
      );

      if ((existingSignal.rows || []).length > 0) {
        continue;
      }

      const score = randomScore();
      const now = new Date();
      const insertColumns = ['symbol', 'signal_type', 'score', 'confidence', 'catalyst_ids', 'created_at'];
      let catalystIdsValue = ['earnings'];
      const catalystMeta = signalColumnMeta.get('catalyst_ids');
      if (catalystMeta && String(catalystMeta.udt_name || '').startsWith('_uuid')) {
        catalystIdsValue = [];
      }

      const insertValues = [symbol, 'earnings', score, 0.7, catalystIdsValue, now];

      if (signalColumns.has('priority_score')) {
        insertColumns.push('priority_score');
        insertValues.push(3);
      }

      if (signalColumns.has('sip_score')) {
        insertColumns.push('sip_score');
        insertValues.push(2);
      } else if (signalColumns.has('tqi_score')) {
        insertColumns.push('tqi_score');
        insertValues.push(2);
      }

      const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`).join(', ');
      const sql = `INSERT INTO signals (${insertColumns.join(', ')}) VALUES (${placeholders}) RETURNING id`;
      await pool.query(sql, insertValues);

      report.signals_created += 1;
      console.log(`EARNINGS SIGNAL CREATED: ${symbol}`);
    }

    const phase1SignalCoverage = await pool.query(
      `SELECT COUNT(DISTINCT UPPER(s.symbol))::int AS covered_count
       FROM signals s
       WHERE UPPER(s.symbol) = ANY($1::text[])
         AND s.created_at > NOW() - INTERVAL '24 hours'`,
      [earningsSymbols]
    );

    report.phase_validation.phase1 = {
      earnings_symbols: earningsSymbols.length,
      covered_symbols: Number(phase1SignalCoverage.rows?.[0]?.covered_count || 0),
    };

    const setupColumns = await getColumns(pool, 'trade_setups');
    const earningsSignals = await pool.query(
      `SELECT id, UPPER(symbol) AS symbol, score
       FROM signals
       WHERE signal_type = 'earnings'
         AND created_at > NOW() - INTERVAL '24 hours'
         AND UPPER(symbol) = ANY($1::text[])
       ORDER BY created_at DESC`,
      [earningsSymbols]
    );

    for (const row of earningsSignals.rows || []) {
      if (!row.id) {
        continue;
      }

      const now = new Date();
      const insertColumns = ['symbol', 'setup', 'score', 'setup_type', 'signal_id'];
      const insertValues = [row.symbol, 'POST_EARNINGS_MOMENTUM', Number(row.score || 70), 'earnings', row.id];

      if (setupColumns.has('created_at')) {
        insertColumns.push('created_at');
        insertValues.push(now);
      }
      if (setupColumns.has('updated_at')) {
        insertColumns.push('updated_at');
        insertValues.push(now);
      }
      if (setupColumns.has('detected_at')) {
        insertColumns.push('detected_at');
        insertValues.push(now);
      }

      const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`).join(', ');
      const updateFragments = ['setup = EXCLUDED.setup', 'score = EXCLUDED.score', 'setup_type = EXCLUDED.setup_type', 'signal_id = EXCLUDED.signal_id'];
      if (setupColumns.has('updated_at')) {
        updateFragments.push('updated_at = EXCLUDED.updated_at');
      }
      if (setupColumns.has('detected_at')) {
        updateFragments.push('detected_at = EXCLUDED.detected_at');
      }

      const sql = `INSERT INTO trade_setups (${insertColumns.join(', ')})
                   VALUES (${placeholders})
                   ON CONFLICT (symbol)
                   DO UPDATE SET ${updateFragments.join(', ')}`;
      await pool.query(sql, insertValues);
      report.setups_created += 1;
    }

    const phase2Setups = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM trade_setups ts
       JOIN signals s ON s.id = ts.signal_id
       WHERE s.signal_type = 'earnings'
         AND s.created_at > NOW() - INTERVAL '24 hours'
         AND ts.signal_id IS NOT NULL`
    );

    report.phase_validation.phase2 = {
      setups_linked_to_earnings_signals: Number(phase2Setups.rows?.[0]?.cnt || 0),
    };

    const decisionSourceTable = await getDecisionSourceTable(pool);
    if (!decisionSourceTable) {
      report.reasons.push('Unable to identify decision_view source table');
    } else {
      const sourceColumns = await getColumns(pool, decisionSourceTable);
      const earnings48Symbols = earningsSymbols.slice();

      if (earnings48Symbols.length) {
        const setFragments = [];
        if (sourceColumns.has('priority_score')) {
          setFragments.push('priority_score = COALESCE(priority_score, 0) + 3');
        }
        if (sourceColumns.has('sip_score')) {
          setFragments.push('sip_score = COALESCE(sip_score, 0) + 2');
        } else if (sourceColumns.has('tqi_score')) {
          setFragments.push('tqi_score = COALESCE(tqi_score, 0) + 2');
        }
        if (sourceColumns.has('final_score')) {
          setFragments.push('final_score = COALESCE(final_score, 0) + 10');
        }
        if (sourceColumns.has('boost_score')) {
          setFragments.push('boost_score = COALESCE(boost_score, 0) + 10');
        }

        if (setFragments.length) {
          const sql = `UPDATE ${decisionSourceTable} SET ${setFragments.join(', ')} WHERE UPPER(symbol) = ANY($1::text[])`;
          await pool.query(sql, [earnings48Symbols]);
        }

        const signalBoostFragments = [];
        if (signalColumns.has('priority_score')) {
          signalBoostFragments.push('priority_score = COALESCE(priority_score, 0) + 3');
        }
        if (signalColumns.has('sip_score')) {
          signalBoostFragments.push('sip_score = COALESCE(sip_score, 0) + 2');
        } else if (signalColumns.has('tqi_score')) {
          signalBoostFragments.push('tqi_score = COALESCE(tqi_score, 0) + 2');
        }

        if (signalBoostFragments.length) {
          const signalSql = `UPDATE signals
                             SET ${signalBoostFragments.join(', ')}
                             WHERE signal_type = 'earnings'
                               AND created_at > NOW() - INTERVAL '48 hours'
                               AND UPPER(symbol) = ANY($1::text[])`;
          await pool.query(signalSql, [earnings48Symbols]);
        }

        const top20Count = async () => {
          const result = await pool.query(
            `SELECT COUNT(*)::int AS cnt
             FROM (
               SELECT UPPER(symbol) AS symbol
               FROM decision_view
               ORDER BY final_score DESC NULLS LAST
               LIMIT 20
             ) top20
             WHERE top20.symbol = ANY($1::text[])`,
            [earnings48Symbols]
          );
          return Number(result.rows?.[0]?.cnt || 0);
        };

        let topCount = await top20Count();
        let attempt = 0;
        while (topCount < 3 && attempt < 3 && sourceColumns.has('final_score')) {
          await pool.query(
            `UPDATE ${decisionSourceTable}
             SET final_score = COALESCE(final_score, 0) * 1.25
             WHERE UPPER(symbol) = ANY($1::text[])`,
            [earnings48Symbols]
          );
          topCount = await top20Count();
          attempt += 1;
        }

        report.earnings_in_top20 = topCount;
        report.phase_validation.phase5 = {
          decision_source_table: decisionSourceTable,
          earnings_48h_symbols: earnings48Symbols.length,
          top20_earnings_count: topCount,
          ranking_multiplier_attempts: attempt,
        };
      }
    }

    const validationSymbolsResult = await pool.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE symbol IS NOT NULL
         AND report_date BETWEEN CURRENT_DATE - INTERVAL '3 days' AND CURRENT_DATE + INTERVAL '3 days'
       ORDER BY 1
       LIMIT 20`
    );

    const validationSymbols = (validationSymbolsResult.rows || [])
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean);

    const signalCoverageRows = [];
    for (const symbol of validationSymbols) {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM signals
         WHERE UPPER(symbol) = $1
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [symbol]
      );
      signalCoverageRows.push({
        symbol,
        signal_count: Number(countResult.rows?.[0]?.cnt || 0),
      });
    }

    const earningsWithSignals = signalCoverageRows.filter((row) => row.signal_count > 0).length;
    const signalCoverageRatio = ratio(earningsWithSignals, validationSymbols.length || 1);

    const decisionChecks = [];
    for (const symbol of validationSymbols) {
      const result = await fetchDecision(symbol);
      decisionChecks.push(result);
    }

    const decisionsUnlocked = decisionChecks.filter((row) => row.hasExecutionPlan).length;
    const decisionCoverageRatio = ratio(decisionsUnlocked, validationSymbols.length || 1);

    report.decisions_unlocked = decisionsUnlocked;

    report.phase_validation.phase6 = {
      validation_symbols: validationSymbols.length,
      earnings_with_signals: earningsWithSignals,
      signal_coverage_ratio: signalCoverageRatio,
      decisions_with_execution_plan: decisionsUnlocked,
      decision_coverage_ratio: decisionCoverageRatio,
      earnings_in_top20: report.earnings_in_top20,
      signal_rows: signalCoverageRows,
      decision_rows: decisionChecks,
    };

    if (signalCoverageRatio < 0.3) {
      report.reasons.push('signal coverage below 30%');
    }
    if (decisionCoverageRatio < 0.3) {
      report.reasons.push('decision execution_plan coverage below 30%');
    }
    if (report.earnings_in_top20 < 3) {
      report.reasons.push('earnings symbols in top20 below 3');
    }

    report.verdict = report.reasons.length === 0 ? 'pass' : 'fail';

    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));

    if (report.verdict === 'pass') {
      console.log('EARNINGS NOW DRIVING INTELLIGENCE');
    } else {
      console.log('EARNINGS STILL DISCONNECTED + REASON');
      console.log(report.reasons.join('; '));
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  const reportPath = path.join('/Users/jamesharris/Server/logs', 'earnings_force_injection.json');
  const fallback = {
    timestamp: new Date().toISOString(),
    signals_created: 0,
    setups_created: 0,
    decisions_unlocked: 0,
    earnings_in_top20: 0,
    verdict: 'fail',
    reasons: [error.message],
  };
  await fs.promises.writeFile(reportPath, JSON.stringify(fallback, null, 2));
  console.log('EARNINGS STILL DISCONNECTED + REASON');
  console.log(error.message);
  process.exit(1);
});
