const express = require('express');

const { requireAdminAccess } = require('../../middleware/requireAdminAccess');
const { queryWithTimeout } = require('../../db/pg');
const {
  getCoveragePriorityPreview,
  getCoverageAdminOverview,
  getDataOverview,
  getPerformanceOverview,
  getSystemCompletionReport,
  getSystemOverview,
  getValidationOverview,
  triggerCoverageRepair,
} = require('../services/adminService');
const { getDataHealth } = require('../../system/dataHealthEngine');
const { getDataIntegrityHealth } = require('../../engines/dataIntegrityEngine');
const { sendBeaconMorningBrief, sendImmediateAdminTests } = require('../../email/emailDispatcher');

const router = express.Router();

router.use(requireAdminAccess);

async function safeQuery(query, params, fallback, label) {
  try {
    const result = await queryWithTimeout(query, params, {
      timeoutMs: 5000,
      label,
      maxRetries: 0,
    });
    return result;
  } catch (_error) {
    return fallback;
  }
}

async function tableExists(tableName) {
  const result = await safeQuery(
    'SELECT to_regclass($1) AS name',
    [`public.${tableName}`],
    { rows: [{ name: null }] },
    `v2.admin.table_exists.${tableName}`
  );

  return Boolean(result.rows?.[0]?.name);
}

router.get('/system', async (_req, res) => {
  try {
    const [overview, completion, dataHealth, systemAlerts] = await Promise.all([
      getSystemOverview(),
      getSystemCompletionReport(),
      getDataHealth().catch(() => ({ status: 'warning', tables: {} })),
      safeQuery(
        `SELECT type, source, severity, message, created_at
         FROM system_alerts
         ORDER BY created_at DESC NULLS LAST
         LIMIT 20`,
        [],
        { rows: [] },
        'v2.admin.system_alerts'
      ),
    ]);
    const integrity = getDataIntegrityHealth();

    return res.json({
      success: true,
      ...overview,
      completion_report: completion,
      system_status: overview?.snapshot?.engine_status === 'running' ? 'ok' : 'warning',
      database_tables: Object.values(dataHealth?.tables || {}).filter((value) => Number(value || 0) > 0).length,
      engines_running: overview?.snapshot?.engine_status === 'running' ? 1 : 0,
      providers_online: 0,
      engine_health: {
        snapshot_engine: {
          status: overview?.snapshot?.engine_status || 'unknown',
          last_update: overview?.snapshot?.last_snapshot_age_seconds != null ? new Date(Date.now() - (Number(overview.snapshot.last_snapshot_age_seconds) * 1000)).toISOString() : null,
        },
        data_integrity_engine: {
          status: integrity?.status || 'idle',
          last_run: integrity?.last_run || null,
        },
      },
      system_alerts: systemAlerts.rows || [],
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/diagnostics', async (_req, res) => {
  try {
    const dataHealth = await getDataHealth().catch(() => ({ status: 'warning', tables: {} }));
    return res.json({
      ok: true,
      status: dataHealth?.status || 'warning',
      database_health: {
        tables: {
          ticker_universe: Number(dataHealth?.tables?.ticker_universe || 0),
          daily_ohlc: Number(dataHealth?.tables?.daily_ohlc || 0),
          daily_ohlcv: Number(dataHealth?.tables?.daily_ohlcv || 0),
          intraday_1m: Number(dataHealth?.tables?.intraday_1m || 0),
          news_articles: Number(dataHealth?.tables?.news_articles || 0),
          earnings_events: Number(dataHealth?.tables?.earnings_events || 0),
          catalyst_signals: Number(dataHealth?.tables?.catalyst_signals || 0),
          trade_setups: Number(dataHealth?.tables?.trade_setups || 0),
          opportunity_stream: Number(dataHealth?.tables?.opportunity_stream || 0),
          trade_outcomes: Number(dataHealth?.tables?.trade_outcomes || 0),
        },
      },
      integrity: getDataIntegrityHealth(),
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/users', async (_req, res) => {
  try {
    const hasUsersTable = await tableExists('users');
    if (!hasUsersTable) {
      return res.json({ ok: true, status: 'table_missing', users: [] });
    }

    const result = await safeQuery(
      `SELECT id, username, email, is_admin, is_active, created_at
       FROM users
       ORDER BY created_at DESC NULLS LAST
       LIMIT 500`,
      [],
      { rows: [] },
      'v2.admin.users'
    );

    return res.json({ ok: true, status: 'ok', users: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, users: [] });
  }
});

router.get('/data', async (_req, res) => {
  try {
    const payload = await getDataOverview();
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/performance', async (_req, res) => {
  try {
    const payload = await getPerformanceOverview();
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/validation', async (_req, res) => {
  try {
    const payload = await getValidationOverview();
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/coverage', async (req, res) => {
  try {
    const refresh = ['1', 'true', 'yes'].includes(String(req.query.refresh || '').trim().toLowerCase());
    const repair = ['1', 'true', 'yes'].includes(String(req.query.repair || '').trim().toLowerCase());
    const payload = await getCoverageAdminOverview({ refresh, performRepair: repair });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/coverage/priority-preview', async (req, res) => {
  try {
    const limit = Math.max(1, Number(req.query.limit) || 50);
    const payload = await getCoveragePriorityPreview({ limit });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/coverage/repair', async (req, res) => {
  try {
    const strategy = String(req.body?.strategy || 'priority').trim().toLowerCase() || 'priority';
    if (strategy !== 'priority') {
      return res.status(400).json({ success: false, error: 'unsupported_strategy', message: 'Only priority strategy is supported.' });
    }

    const limit = Math.max(1, Number(req.body?.limit) || 100);
    const payload = await triggerCoverageRepair({ limit, strategy });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/email-test', async (req, res) => {
  try {
    const recipient = String(req.body?.recipient || req.body?.email || process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim();
    const newsletterType = String(req.body?.newsletterType || 'all').trim().toLowerCase();

    let result;
    if (newsletterType === 'beacon_morning') {
      result = {
        beaconMorningBrief: await sendBeaconMorningBrief({
          force: true,
          forceTo: recipient,
          campaignKey: `test_beacon_${Date.now()}`,
        }),
      };
    } else {
      result = await sendImmediateAdminTests(recipient);
    }

    return res.json({ success: true, recipient, data: result, result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to run test sends' });
  }
});

module.exports = router;