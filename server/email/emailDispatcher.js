const { Resend } = require('resend');
const cron = require('node-cron');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const newsletterService = require('../services/newsletterService');
const { generateBeaconMorningPayload } = require('./beaconMorningBrief');
const { renderBeaconMorningTemplate } = require('./templates/BeaconMorningTemplate');
const { renderBreakingAlertTemplate } = require('./templates/BreakingAlertTemplate');
const { renderEarningsTemplate } = require('./templates/EarningsTemplate');
const { renderWeeklyScorecardTemplate } = require('./templates/WeeklyScorecardTemplate');
const { renderSystemMonitorTemplate } = require('./templates/SystemMonitorTemplate');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'OpenRange <noreply@openrangetrading.co.uk>';

const scheduleState = {
  inFlight: new Set(),
  schedulerStarted: false,
  jobs: {},
  lastRuns: {
    beaconMorningBrief: null,
    breakingAlert: null,
    earningsIntelligence: null,
    weeklyScorecard: null,
    systemMonitor: null,
  },
};

function markLastRun(type, result) {
  scheduleState.lastRuns[type] = {
    at: new Date().toISOString(),
    success: Boolean(result?.success),
    skipped: Boolean(result?.skipped),
    reason: result?.reason || null,
    campaignKey: result?.campaignKey || null,
  };
}

function todayKey(prefix) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${prefix}_${y}${m}${day}`;
}

async function wasCampaignSent(campaignKey) {
  const sql = `SELECT COUNT(*)::int AS count FROM newsletter_send_history WHERE campaign_key = $1`;
  const { rows } = await queryWithTimeout(sql, [campaignKey], {
    timeoutMs: 5000,
    label: 'email.dispatcher.was_campaign_sent',
    maxRetries: 0,
  }).catch(() => ({ rows: [{ count: 0 }] }));

  return Number(rows[0]?.count || 0) > 0;
}

async function getAdminRecipients() {
  const sql = `SELECT email FROM users WHERE is_admin = true AND email IS NOT NULL`;
  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs: 5000,
    label: 'email.dispatcher.admin_recipients',
    maxRetries: 0,
  }).catch(() => ({ rows: [] }));

  return Array.from(new Set((rows || []).map((r) => String(r.email || '').trim()).filter(Boolean)));
}

async function resolveRecipients(preferenceType, forceTo = null) {
  if (forceTo) {
    return [forceTo];
  }

  const subscribed = await newsletterService.resolveSubscribedRecipients({
    emailType: preferenceType,
    fallbackToLegacy: true,
  }).catch(() => []);

  const admins = await getAdminRecipients();
  return Array.from(new Set([...subscribed, ...admins]));
}

async function sendEmail({ subject, html, recipients, campaignKey, campaignType }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return {
      success: false,
      message: 'No recipients',
      recipients: [],
    };
  }

  if (!resend) {
    return {
      success: false,
      message: 'RESEND_API_KEY not configured',
      recipients,
    };
  }

  const response = await resend.emails.send({
    from: fromEmail,
    to: recipients,
    subject,
    html,
  });

  await newsletterService.recordNewsletterSendHistory({
    campaignType,
    campaignName: subject,
    campaignKey,
    status: 'sent',
    recipients,
    responsePayload: response,
  }).catch(() => undefined);

  return {
    success: true,
    recipients,
    response,
  };
}

async function withScheduleLock(key, fn) {
  if (scheduleState.inFlight.has(key)) {
    return { success: false, skipped: true, reason: 'already_in_flight' };
  }

  scheduleState.inFlight.add(key);
  try {
    return await fn();
  } finally {
    scheduleState.inFlight.delete(key);
  }
}

async function sendBeaconMorningBrief({ force = false, forceTo = null, campaignKey = null } = {}) {
  const key = campaignKey || todayKey('beacon_morning');
  return withScheduleLock(key, async () => {
    if (!force) {
      const exists = await wasCampaignSent(key);
      if (exists) {
        return { success: true, skipped: true, reason: 'already_sent', campaignKey: key };
      }
    }

    const briefPayload = await generateBeaconMorningPayload({ limit: 5 });
    const html = renderBeaconMorningTemplate(briefPayload);
    const recipients = await resolveRecipients('morningBrief', forceTo);

    const result = await sendEmail({
      subject: 'OpenRange Beacon Morning Brief',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'beaconMorningBrief',
    });

    logger.info('[EMAIL_DISPATCHER] beacon morning sent', {
      campaignKey: key,
      success: result.success,
      recipients: recipients.length,
    });

    const dispatchResult = { ...result, campaignKey: key, type: 'beaconMorningBrief' };
    markLastRun('beaconMorningBrief', dispatchResult);
    return dispatchResult;
  });
}

async function loadBreakingCandidate() {
  const sql = `
    SELECT symbol, catalyst, setup_reasoning, beacon_probability, expected_move
    FROM institutional_radar_signals
    WHERE beacon_probability >= 0.8 AND expected_move >= 2.0
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs: 6000,
    label: 'email.dispatcher.breaking_candidate',
    maxRetries: 0,
  }).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function sendBreakingAlert({ force = false, forceTo = null, campaignKey = null } = {}) {
  const key = campaignKey || `${todayKey('breaking_alert')}_${new Date().getUTCHours()}`;
  return withScheduleLock(key, async () => {
    if (!force) {
      const exists = await wasCampaignSent(key);
      if (exists) {
        return { success: true, skipped: true, reason: 'already_sent', campaignKey: key };
      }
    }

    const candidate = await loadBreakingCandidate();
    if (!candidate) {
      return { success: true, skipped: true, reason: 'no_candidate', campaignKey: key };
    }

    const html = renderBreakingAlertTemplate({
      symbol: candidate.symbol,
      catalyst: candidate.catalyst,
      momentum: `Beacon ${(Number(candidate.beacon_probability || 0) * 100).toFixed(1)} / Move ${Number(candidate.expected_move || 0).toFixed(2)}%`,
      tradePlan: candidate.setup_reasoning,
      chartUrl: `https://finviz.com/chart.ashx?t=${encodeURIComponent(candidate.symbol)}`,
    });

    const recipients = await resolveRecipients('breakingAlerts', forceTo);
    const result = await sendEmail({
      subject: `OpenRange Breaking Alert: ${candidate.symbol}`,
      html,
      recipients,
      campaignKey: key,
      campaignType: 'breakingAlert',
    });

    const dispatchResult = { ...result, campaignKey: key, type: 'breakingAlert', symbol: candidate.symbol };
    markLastRun('breakingAlert', dispatchResult);
    return dispatchResult;
  });
}

async function sendEarningsIntelligence({ force = false, forceTo = null, campaignKey = null } = {}) {
  const key = campaignKey || `${todayKey('earnings')}_${Math.floor((new Date().getUTCDate() - 1) / 7) + 1}`;
  return withScheduleLock(key, async () => {
    if (!force) {
      const exists = await wasCampaignSent(key);
      if (exists) {
        return { success: true, skipped: true, reason: 'already_sent', campaignKey: key };
      }
    }

    const { rows } = await queryWithTimeout(
      `SELECT symbol, earnings_date::text, expected_move, setup
       FROM earnings_calendar
       WHERE earnings_date >= CURRENT_DATE
       ORDER BY earnings_date ASC
       LIMIT 25`,
      [],
      { timeoutMs: 6000, label: 'email.dispatcher.earnings', maxRetries: 0 }
    ).catch(() => ({ rows: [] }));

    const html = renderEarningsTemplate({ items: rows || [] });
    const recipients = await resolveRecipients('earningsIntel', forceTo);
    const result = await sendEmail({
      subject: 'OpenRange Earnings Intelligence',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'earningsIntelligence',
    });

    return { ...result, campaignKey: key, type: 'earningsIntelligence' };
  });
}

async function sendWeeklyScorecard({ force = false, forceTo = null, campaignKey = null } = {}) {
  const key = campaignKey || `${todayKey('weekly_scorecard')}_${new Date().getUTCDay()}`;
  return withScheduleLock(key, async () => {
    if (!force) {
      const exists = await wasCampaignSent(key);
      if (exists) {
        return { success: true, skipped: true, reason: 'already_sent', campaignKey: key };
      }
    }

    const { rows } = await queryWithTimeout(
            `SELECT symbol,
              MIN(entry_price)::numeric(10,2)::text AS entry,
              MAX(high_price)::numeric(10,2)::text AS high,
              ROUND(AVG(return_pct)::numeric, 2) AS return_pct
       FROM opportunity_stream_performance
       WHERE date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY symbol
       ORDER BY AVG(return_pct) DESC
       LIMIT 25`,
      [],
      { timeoutMs: 6000, label: 'email.dispatcher.weekly_scorecard', maxRetries: 0 }
    ).catch(() => ({ rows: [] }));

    const avg = rows.length ? `${(rows.reduce((a, r) => a + Number(r.return_pct || 0), 0) / rows.length).toFixed(2)}%` : '—';
    const html = renderWeeklyScorecardTemplate({
      rows: (rows || []).map((r) => ({
        symbol: r.symbol,
        entry: r.entry,
        high: r.high,
        returnPct: `${Number(r.return_pct || 0).toFixed(2)}%`,
      })),
      successRate: rows.length ? `${Math.round((rows.filter((r) => Number(r.return_pct || 0) > 0).length / rows.length) * 100)}%` : '—',
      averageReturn: avg,
    });

    const recipients = await resolveRecipients('weeklyReview', forceTo);
    const result = await sendEmail({
      subject: 'OpenRange Weekly Scorecard',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'weeklyScorecard',
    });

    const dispatchResult = { ...result, campaignKey: key, type: 'weeklyScorecard' };
    markLastRun('weeklyScorecard', dispatchResult);
    return dispatchResult;
  });
}

async function fetchSystemMonitorData() {
  const { rows: engines } = await queryWithTimeout(
    `SELECT engine_name AS name,
            COALESCE(status, 'unknown') AS status,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_run_at, NOW())))::int, 0) AS lag_seconds
     FROM engine_status
     ORDER BY engine_name ASC`,
    [],
    { timeoutMs: 5000, label: 'email.dispatcher.system_monitor.engines', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const { rows: errors } = await queryWithTimeout(
    `SELECT level, message
     FROM system_events
     WHERE created_at >= NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 10`,
    [],
    { timeoutMs: 5000, label: 'email.dispatcher.system_monitor.events', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return {
    engines: (engines || []).map((e) => ({ name: e.name, status: e.status, lagSeconds: e.lag_seconds })),
    alerts: (errors || []).map((e) => `[${String(e.level || 'info').toUpperCase()}] ${e.message}`),
    apiLatency: 'operational',
    dbLatency: 'operational',
    errorCount: String((errors || []).length),
  };
}

async function sendSystemMonitor({ force = false, forceTo = null, campaignKey = null } = {}) {
  const key = campaignKey || `${todayKey('system_monitor')}_${new Date().getUTCHours()}`;
  return withScheduleLock(key, async () => {
    if (!force) {
      const exists = await wasCampaignSent(key);
      if (exists) {
        return { success: true, skipped: true, reason: 'already_sent', campaignKey: key };
      }
    }

    const monitor = await fetchSystemMonitorData();
    const html = renderSystemMonitorTemplate(monitor);
    const recipients = await resolveRecipients('systemMonitor', forceTo);

    const result = await sendEmail({
      subject: 'OpenRange System Monitor',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'systemMonitor',
    });

    const dispatchResult = { ...result, campaignKey: key, type: 'systemMonitor' };
    markLastRun('systemMonitor', dispatchResult);
    return dispatchResult;
  });
}

function registerEmailIntelligenceSchedules() {
  if (scheduleState.schedulerStarted) {
    return scheduleState.jobs;
  }

  scheduleState.schedulerStarted = true;

  scheduleState.jobs.beaconMorningBrief = cron.schedule('45 7 * * 1-5', async () => {
    await sendBeaconMorningBrief().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled beacon morning failure', { message: error.message });
    });
  }, { timezone: 'America/New_York' });

  scheduleState.jobs.breakingAlert = cron.schedule('*/15 9-16 * * 1-5', async () => {
    await sendBreakingAlert().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled breaking alert failure', { message: error.message });
    });
  }, { timezone: 'America/New_York' });

  scheduleState.jobs.earningsIntelligence = cron.schedule('0 18 * * 0', async () => {
    await sendEarningsIntelligence().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled earnings failure', { message: error.message });
    });
  }, { timezone: 'America/New_York' });

  scheduleState.jobs.weeklyScorecard = cron.schedule('30 17 * * 5', async () => {
    await sendWeeklyScorecard().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled weekly scorecard failure', { message: error.message });
    });
  }, { timezone: 'America/New_York' });

  scheduleState.jobs.systemMonitor = cron.schedule('0 9 * * *', async () => {
    await sendSystemMonitor().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled system monitor failure', { message: error.message });
    });
  }, { timezone: 'America/New_York' });

  logger.info('[EMAIL_DISPATCHER] schedules registered', {
    beaconMorningBrief: '45 7 * * 1-5 ET',
    breakingAlert: '*/15 9-16 * * 1-5 ET',
    earningsIntelligence: '0 18 * * 0 ET',
    weeklyScorecard: '30 17 * * 5 ET',
    systemMonitor: '0 9 * * * ET',
  });

  return scheduleState.jobs;
}

function getEmailDispatcherStatus() {
  return {
    schedulerStarted: scheduleState.schedulerStarted,
    jobs: Object.keys(scheduleState.jobs),
    inFlightKeys: Array.from(scheduleState.inFlight),
    lastRuns: scheduleState.lastRuns,
    resendConfigured: Boolean(resend),
  };
}

async function sendImmediateAdminTests(adminEmail) {
  const recipient = adminEmail || process.env.ADMIN_EMAIL || process.env.MORNING_BRIEF_RECIPIENTS || null;
  const results = {
    beaconMorningBrief: await sendBeaconMorningBrief({ force: true, forceTo: recipient, campaignKey: `${todayKey('test_beacon')}_${Date.now()}` }),
    systemMonitor: await sendSystemMonitor({ force: true, forceTo: recipient, campaignKey: `${todayKey('test_sysmon')}_${Date.now()}` }),
  };

  logger.info('[EMAIL_DISPATCHER] immediate admin tests complete', {
    recipient,
    beaconSuccess: !!results.beaconMorningBrief?.success,
    monitorSuccess: !!results.systemMonitor?.success,
  });

  return results;
}

module.exports = {
  sendBeaconMorningBrief,
  sendBreakingAlert,
  sendEarningsIntelligence,
  sendWeeklyScorecard,
  sendSystemMonitor,
  sendImmediateAdminTests,
  registerEmailIntelligenceSchedules,
  getEmailDispatcherStatus,
};
