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
const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'OpenRange <intel@openrangetrading.co.uk>';
const EMAIL_TYPES = newsletterService.EMAIL_TYPES || {};

if (!process.env.RESEND_API_KEY) {
  console.warn('[EMAIL] RESEND_API_KEY missing — email system disabled');
}

const scheduleConfig = {
  timezone: 'Europe/London',
  beaconMorningBrief: '0 7 * * 1-5',
  breakingAlert: '*/15 8-17 * * 1-5',
  earningsIntelligence: '0 18 * * 0',
  weeklyScorecard: '30 17 * * 5',
  systemMonitor: '0 9 * * *',
};

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
  const sql = `
    SELECT email
    FROM users
    WHERE email IS NOT NULL
      AND COALESCE(is_admin::text, 'false') IN ('1', 'true', 't')
  `;
  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs: 5000,
    label: 'email.dispatcher.admin_recipients',
    maxRetries: 0,
  }).catch(() => ({ rows: [] }));

  return Array.from(new Set((rows || []).map((r) => String(r.email || '').trim()).filter(Boolean)));
}

async function getPreferenceRecipients(preferenceType) {
  const sql = `
    SELECT email
    FROM email_preferences
    WHERE is_enabled = TRUE
      AND preference_key = $1
      AND email IS NOT NULL
  `;

  const { rows } = await queryWithTimeout(sql, [preferenceType], {
    timeoutMs: 5000,
    label: 'email.dispatcher.preference_recipients',
    maxRetries: 0,
  }).catch(() => ({ rows: [] }));

  return (rows || [])
    .map((row) => String(row.email || '').trim().toLowerCase())
    .filter(Boolean);
}

function toNewsletterPreferenceType(preferenceType) {
  const normalized = String(preferenceType || '').trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (Object.values(EMAIL_TYPES).includes(normalized)) {
    return normalized;
  }

  const preferenceMap = {
    morningbrief: EMAIL_TYPES.MORNING_BEACON_BRIEF,
    beaconmorningbrief: EMAIL_TYPES.MORNING_BEACON_BRIEF,
    premarketmovers: EMAIL_TYPES.PREMARKET_MOVERS,
    breakingalerts: EMAIL_TYPES.HIGH_CONVICTION_ALERTS,
    earningsintel: EMAIL_TYPES.EVENING_REVIEW,
    weeklyreview: EMAIL_TYPES.EVENING_REVIEW,
    systemmonitor: null,
  };

  return preferenceMap[normalized] ?? null;
}

async function getNewsletterRecipients(preferenceType) {
  const newsletterPreferenceType = toNewsletterPreferenceType(preferenceType);
  if (!newsletterPreferenceType) {
    return [];
  }

  return newsletterService.resolveSubscribedRecipients({
    emailType: newsletterPreferenceType,
    fallbackToLegacy: true,
  }).catch(() => []);
}

async function resolveRecipients(preferenceType, forceTo = null) {
  if (forceTo) {
    return [String(forceTo).trim().toLowerCase()];
  }

  // Fallback order:
  // 1) email_preferences
  // 2) newsletter_subscribers
  // 3) admin users
  // 4) ADMIN_EMAIL env
  const preferenceRecipients = await getPreferenceRecipients(preferenceType);
  const newsletterRecipients = await getNewsletterRecipients(preferenceType);
  const adminRecipients = await getAdminRecipients();
  const envRecipient = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();

  const merged = Array.from(new Set([
    ...preferenceRecipients,
    ...newsletterRecipients,
    ...adminRecipients,
    ...(envRecipient ? [envRecipient] : []),
  ].filter(Boolean)));

  if (merged.length > 0) {
    return merged;
  }

  const finalEnvFallback = String(process.env.MORNING_BRIEF_RECIPIENTS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (finalEnvFallback.length > 0) {
    return finalEnvFallback;
  }

  return [String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim().toLowerCase()];
}

async function sendPasswordResetEmail({ to, token, expiresAt }) {
  const recipient = String(to || '').trim();
  if (!recipient) {
    return { success: false, message: 'Missing recipient' };
  }

  const baseAppUrl = String(process.env.APP_BASE_URL || process.env.CLIENT_BASE_URL || 'https://openrangetrading.co.uk').replace(/\/$/, '');
  const resetUrl = `${baseAppUrl}/reset-password?token=${encodeURIComponent(String(token || ''))}`;
  const expiryLabel = new Date(expiresAt || Date.now() + 60 * 60 * 1000).toISOString();

  const html = `
    <div style="font-family:Arial,sans-serif;background:#020617;color:#e2e8f0;padding:18px;">
      <h2 style="margin:0 0 10px 0;color:#38bdf8;">OpenRange Password Reset</h2>
      <p style="margin:0 0 12px 0;line-height:1.6;">A password reset was requested for your account. This link expires in 1 hour.</p>
      <p style="margin:0 0 14px 0;"><a href="${resetUrl}" style="display:inline-block;background:#38bdf8;color:#0b1220;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;">Reset Password</a></p>
      <p style="margin:0 0 8px 0;font-size:12px;color:#94a3b8;">Expires at: ${expiryLabel}</p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  return sendEmail({
    subject: 'OpenRange Password Reset',
    html,
    recipients: [recipient],
    campaignKey: `password_reset_${Date.now()}`,
    campaignType: 'passwordReset',
  });
}

async function sendEmail({ subject, html, recipients, campaignKey, campaignType, audience = null }) {
  const safeRecipients = Array.isArray(recipients) && recipients.length > 0
    ? recipients
    : [String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim()];

  if (!resend) {
    console.warn('[EMAIL] provider unavailable');
    return {
      success: false,
      reason: 'provider-not-configured',
      message: 'RESEND_API_KEY not configured',
      recipients: safeRecipients,
    };
  }

  try {
    const response = await resend.emails.send({
      from: fromEmail,
      to: safeRecipients,
      subject,
      html,
    });

    await newsletterService.recordNewsletterSendHistory({
      subject,
      campaignType,
      campaignKey,
      audience,
      status: 'sent',
      recipientsCount: safeRecipients.length,
      providerId: response?.data?.id || null,
      metadata: {
        provider: 'resend',
        responseId: response?.data?.id || null,
      },
    }).catch(() => undefined);

    console.log('[EMAIL SENT]', subject);

    return {
      success: true,
      recipients: safeRecipients,
      response,
    };
  } catch (err) {
    console.error('[EMAIL ERROR]', err);
    return {
      success: false,
      reason: 'provider-error',
      recipients: safeRecipients,
      error: err?.message || 'Email provider error',
    };
  }
}

function getNextWeekdayRunInLondon(hour, minute) {
  const now = new Date();
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: scheduleConfig.timezone, weekday: 'short' });
  const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: scheduleConfig.timezone, hour: '2-digit', minute: '2-digit', hour12: false });
  const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: scheduleConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

  const weekday = dayFmt.format(now);
  const [hh, mm] = hmFmt.format(now).split(':').map((v) => Number(v));
  const nowMinutes = (hh * 60) + mm;
  const targetMinutes = (hour * 60) + minute;

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const idx = weekdays.indexOf(weekday);
  let addDays = 0;

  if (idx === -1) {
    addDays = weekday === 'Sat' ? 2 : 1;
  } else if (nowMinutes >= targetMinutes) {
    addDays = idx === 4 ? 3 : 1;
  }

  const next = new Date(now.getTime() + (addDays * 24 * 60 * 60 * 1000));
  return `${dateFmt.format(next).replace(/\//g, '-')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${scheduleConfig.timezone}`;
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
    const recipients = await resolveRecipients(EMAIL_TYPES.MORNING_BEACON_BRIEF, forceTo);

    const result = await sendEmail({
      subject: 'OpenRange Beacon Morning Brief',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'beaconMorningBrief',
      audience: EMAIL_TYPES.MORNING_BEACON_BRIEF,
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

    const recipients = await resolveRecipients(EMAIL_TYPES.HIGH_CONVICTION_ALERTS, forceTo);
    const result = await sendEmail({
      subject: `OpenRange Breaking Alert: ${candidate.symbol}`,
      html,
      recipients,
      campaignKey: key,
      campaignType: 'breakingAlert',
      audience: EMAIL_TYPES.HIGH_CONVICTION_ALERTS,
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
    const recipients = await resolveRecipients(EMAIL_TYPES.EVENING_REVIEW, forceTo);
    const result = await sendEmail({
      subject: 'OpenRange Earnings Intelligence',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'earningsIntelligence',
      audience: EMAIL_TYPES.EVENING_REVIEW,
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

    const recipients = await resolveRecipients(EMAIL_TYPES.EVENING_REVIEW, forceTo);
    const result = await sendEmail({
      subject: 'OpenRange Weekly Scorecard',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'weeklyScorecard',
      audience: EMAIL_TYPES.EVENING_REVIEW,
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
    const recipients = await resolveRecipients(null, forceTo);

    const result = await sendEmail({
      subject: 'OpenRange System Monitor',
      html,
      recipients,
      campaignKey: key,
      campaignType: 'systemMonitor',
      audience: 'admin',
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

  scheduleState.jobs.beaconMorningBrief = cron.schedule(scheduleConfig.beaconMorningBrief, async () => {
    await sendBeaconMorningBrief().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled beacon morning failure', { message: error.message });
    });
  }, { timezone: scheduleConfig.timezone });

  scheduleState.jobs.breakingAlert = cron.schedule(scheduleConfig.breakingAlert, async () => {
    await sendBreakingAlert().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled breaking alert failure', { message: error.message });
    });
  }, { timezone: scheduleConfig.timezone });

  scheduleState.jobs.earningsIntelligence = cron.schedule(scheduleConfig.earningsIntelligence, async () => {
    await sendEarningsIntelligence().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled earnings failure', { message: error.message });
    });
  }, { timezone: scheduleConfig.timezone });

  scheduleState.jobs.weeklyScorecard = cron.schedule(scheduleConfig.weeklyScorecard, async () => {
    await sendWeeklyScorecard().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled weekly scorecard failure', { message: error.message });
    });
  }, { timezone: scheduleConfig.timezone });

  scheduleState.jobs.systemMonitor = cron.schedule(scheduleConfig.systemMonitor, async () => {
    await sendSystemMonitor().catch((error) => {
      logger.warn('[EMAIL_DISPATCHER] scheduled system monitor failure', { message: error.message });
    });
  }, { timezone: scheduleConfig.timezone });

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
    provider: 'Resend',
    providerConfigured: Boolean(process.env.RESEND_API_KEY),
    fallbackRecipient: process.env.ADMIN_EMAIL || 'jamesharris4@me.com',
    schedulerRunning: scheduleState.schedulerStarted,
    timezone: scheduleConfig.timezone,
    nextMorningBrief: getNextWeekdayRunInLondon(7, 0),
    schedules: scheduleConfig,
    nextScheduledSend: getNextWeekdayRunInLondon(7, 0),
  };
}

async function sendImmediateAdminTests(adminEmail) {
  const recipient = String(adminEmail || process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim();
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
  sendPasswordResetEmail,
};
