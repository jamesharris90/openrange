'use strict';

/**
 * Admin Health Engine
 *
 * Sends system health email to admin users twice daily:
 *   08:00 UK — Morning health check
 *   18:00 UK — Evening health check
 *
 * Subject:
 *   CRITICAL: "⚠️ OpenRange System Alert — Action Required"
 *   HEALTHY:  "OpenRange System Status — Healthy"
 */

const { queryWithTimeout } = require('../db/pg');
const { computeSystemScore } = require('./systemScoreEngine');
const { renderAdminHealthTemplate } = require('../email/templates/AdminHealthTemplate');

const LABEL = '[ADMIN_HEALTH]';

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchHealthMetrics() {
  const [learningRes, simRes, pipelineRes] = await Promise.all([
    queryWithTimeout(
      `SELECT
         COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS signals_24h,
         COUNT(*) FILTER (WHERE evaluated = true AND evaluated_at >= NOW() - INTERVAL '24 hours') AS evaluated_24h,
         COUNT(*) FILTER (WHERE outcome = 'ERROR' AND evaluated_at >= NOW() - INTERVAL '24 hours') AS errors_24h,
         COUNT(*) FILTER (WHERE evaluated = false AND timestamp < NOW() - INTERVAL '1 hour') AS stuck
       FROM signal_log`,
      [],
      { timeoutMs: 10000, label: `${LABEL}.learning` }
    ).catch(() => ({ rows: [{ signals_24h: 0, evaluated_24h: 0, errors_24h: 0, stuck: 0 }] })),

    queryWithTimeout(
      `SELECT
         COUNT(*) FILTER (WHERE outcome = 'WIN')  AS wins,
         COUNT(*) FILTER (WHERE outcome = 'LOSS') AS losses,
         COUNT(*) AS total,
         ROUND(AVG(max_upside_pct)::numeric, 2)   AS avg_return
       FROM signal_log
       WHERE evaluated = true AND timestamp >= NOW() - INTERVAL '7 days'`,
      [],
      { timeoutMs: 10000, label: `${LABEL}.sim` }
    ).catch(() => ({ rows: [{ wins: 0, losses: 0, total: 0, avg_return: null }] })),

    Promise.all([
      { name: 'market_quotes',   tsCol: 'updated_at' },
      { name: 'intraday_1m',     tsCol: 'timestamp'  },
      { name: 'daily_ohlc',      tsCol: 'updated_at' },
      { name: 'news_articles',   tsCol: 'published_at' },
    ].map(async ({ name, tsCol }) => {
      try {
        const { rows } = await queryWithTimeout(
          `SELECT COUNT(*) AS cnt, MAX("${tsCol}") AS last_ts FROM ${name}`,
          [],
          { timeoutMs: 6000, label: `${LABEL}.pipeline.${name}`, maxRetries: 0 }
        );
        const row = rows[0];
        const lastTs = row.last_ts ? new Date(row.last_ts) : null;
        const ageMin = lastTs ? Math.floor((Date.now() - lastTs.getTime()) / 60000) : null;
        const status = ageMin === null ? 'unknown' : ageMin < 60 ? 'green' : ageMin < 1440 ? 'amber' : 'red';
        const ageLabel = ageMin === null ? '—' : ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;
        return { table: name, row_count: Number(row.cnt || 0), age_label: ageLabel, status };
      } catch {
        return { table: name, row_count: 0, age_label: '—', status: 'red' };
      }
    })),
  ]);

  const lr = learningRes.rows[0] || {};
  const sr = simRes.rows[0] || {};

  const signals24h  = Number(lr.signals_24h  || 0);
  const evaluated24h = Number(lr.evaluated_24h || 0);
  const errors24h   = Number(lr.errors_24h   || 0);
  const stuckCount  = Number(lr.stuck        || 0);

  const totalSig = Math.max(signals24h, 1);
  const evalRate = Math.round((evaluated24h / totalSig) * 1000) / 10;

  const total7d  = Number(sr.total || 0);
  const wins7d   = Number(sr.wins  || 0);
  const winRate7d = total7d > 0 ? Math.round((wins7d / total7d) * 1000) / 10 : null;
  const avgReturn = sr.avg_return != null ? Number(sr.avg_return) : null;

  return {
    signals_logged_24h: signals24h,
    signals_evaluated_24h: evaluated24h,
    evaluation_rate_pct: evalRate,
    errors_24h: errors24h,
    stuck_signals: stuckCount,
    win_rate_7d: winRate7d,
    avg_return_today: avgReturn,
    pipeline: pipelineRes,
  };
}

async function getAdminEmails() {
  const { rows } = await queryWithTimeout(
    `SELECT email FROM users WHERE (is_admin = true OR is_admin = 1) AND email IS NOT NULL`,
    [],
    { timeoutMs: 8000, label: `${LABEL}.admin_emails` }
  ).catch(() => ({ rows: [] }));

  const emails = (rows || []).map(r => String(r.email || '').trim().toLowerCase()).filter(Boolean);
  const fallback = String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim();
  return emails.length > 0 ? Array.from(new Set([...emails, fallback])) : [fallback];
}

async function sendHealthEmail(subject, html, recipients) {
  const { Resend } = require('resend');
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) {
    console.warn(`${LABEL} RESEND_API_KEY not set — email skipped`);
    return { success: false, reason: 'provider-not-configured' };
  }
  const from = process.env.EMAIL_FROM || 'OpenRange <intel@openrangetrading.co.uk>';
  await resend.emails.send({ from, to: recipients, subject, html });

  await queryWithTimeout(
    `INSERT INTO newsletter_send_history
       (subject, campaign_type, campaign_key, audience, recipients_count, status, sent_at)
     VALUES ($1, $2, $3, $4, $5, 'sent', NOW())`,
    [subject, 'admin_health', `admin_health_${new Date().toISOString().replace(/:/g, '-').slice(0, 16)}`, 'admin', recipients.length],
    { timeoutMs: 8000, label: `${LABEL}.record`, maxRetries: 0, poolType: 'write' }
  ).catch(() => {});

  return { success: true, recipients_count: recipients.length };
}

// ─── Main run function ────────────────────────────────────────────────────────

async function runAdminHealthEngine({ force = false, session = 'auto' } = {}) {
  const t0 = Date.now();
  console.log(`${LABEL} starting (session=${session})`);

  const [scoreData, metrics, recipients] = await Promise.all([
    computeSystemScore().catch(() => ({ score: 0, status: 'UNKNOWN', components: {} })),
    fetchHealthMetrics().catch(() => ({})),
    getAdminEmails().catch(() => [String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com')]),
  ]);

  if (recipients.length === 0) {
    console.log(`${LABEL} no admin recipients — skipping`);
    return { ok: true, skipped: true, reason: 'no_admin_recipients' };
  }

  const ukTime = new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const payload = {
    ...scoreData,
    ...metrics,
    session_label: ukTime,
  };

  const isCritical = scoreData.status === 'CRITICAL'
    || (metrics.evaluation_rate_pct != null && metrics.evaluation_rate_pct < 95)
    || (metrics.stuck_signals != null && metrics.stuck_signals > 0)
    || (metrics.errors_24h != null && metrics.errors_24h > 5);

  const subject = isCritical
    ? `⚠️ OpenRange System Alert — Action Required (Score: ${scoreData.score})`
    : `OpenRange System Status — ${scoreData.status} (Score: ${scoreData.score})`;

  const html = renderAdminHealthTemplate(payload);
  const result = await sendHealthEmail(subject, html, recipients);

  const ms = Date.now() - t0;
  console.log(`${LABEL} complete — score=${scoreData.score} status=${scoreData.status} critical=${isCritical} recipients=${recipients.length} ${ms}ms`);

  return {
    ok: true,
    skipped: false,
    score: scoreData.score,
    status: scoreData.status,
    is_critical: isCritical,
    recipients: recipients.length,
    subject,
    duration_ms: ms,
    ...result,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startAdminHealthScheduler() {
  if (_timer) return;
  const cron = require('node-cron');

  // 08:00 and 18:00 UK daily
  _timer = cron.schedule('0 8,18 * * *', () => {
    const hour = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false });
    runAdminHealthEngine({ session: hour === '08' ? 'morning' : 'evening' }).catch(err =>
      console.error(`${LABEL} scheduled run failed:`, err.message)
    );
  }, { timezone: 'Europe/London' });

  console.log(`${LABEL} scheduler started (08:00 + 18:00 UK daily)`);
}

function stopAdminHealthScheduler() {
  if (_timer) { _timer.stop(); _timer = null; }
}

module.exports = {
  runAdminHealthEngine,
  startAdminHealthScheduler,
  stopAdminHealthScheduler,
};
