'use strict';

/**
 * Premarket Briefing Engine
 *
 * Runs weekdays 13:00 UK (08:00 ET) — 30 min before US open.
 * Sends email to newsletter subscribers with:
 *   1. Top Premarket Movers
 *   2. High Conviction Setups
 *   3. Execution Watchlist
 *   4. Risk Warnings
 */

const { queryWithTimeout } = require('../db/pg');
const { renderPremarketBriefTemplate } = require('../email/templates/PremarketBriefTemplate');

const LABEL = '[PREMARKET_BRIEF]';

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchPremarketMovers() {
  const { rows } = await queryWithTimeout(
    `SELECT
       pw.symbol,
       pw.premarket_gap          AS premarket_gap,
       pw.premarket_volume       AS premarket_volume,
       pw.execution_rating,
       pw.execution_type,
       pw.premarket_signal_type,
       pw.score,
       COALESCE(pw.premarket_valid, false) AS premarket_valid
     FROM premarket_watchlist pw
     WHERE pw.score > 0
       AND pw.updated_at >= NOW() - INTERVAL '3 hours'
     ORDER BY pw.score DESC
     LIMIT 15`,
    [],
    { timeoutMs: 10000, label: `${LABEL}.movers` }
  );
  return rows || [];
}

async function fetchHighConvictionSetups() {
  const { rows } = await queryWithTimeout(
    `SELECT
       pw.symbol,
       pw.execution_rating,
       pw.execution_type,
       pw.entry_price,
       pw.stop_price,
       pw.target_price,
       pw.risk_reward_ratio,
       pw.execution_valid,
       pw.execution_notes,
       pw.breakout_strength,
       pw.premarket_signal_type
     FROM premarket_watchlist pw
     WHERE pw.execution_rating IN ('ELITE', 'GOOD')
       AND pw.execution_valid = true
       AND pw.entry_price IS NOT NULL
       AND pw.updated_at >= NOW() - INTERVAL '3 hours'
     ORDER BY
       CASE pw.execution_rating WHEN 'ELITE' THEN 0 WHEN 'GOOD' THEN 1 ELSE 2 END ASC,
       pw.score DESC
     LIMIT 8`,
    [],
    { timeoutMs: 10000, label: `${LABEL}.setups` }
  );
  return rows || [];
}

async function fetchWatchlist() {
  const { rows } = await queryWithTimeout(
    `SELECT
       pw.symbol,
       pw.entry_price   AS pm_high,
       pw.stop_price    AS pm_low,
       pw.execution_rating,
       pw.score
     FROM premarket_watchlist pw
     WHERE pw.entry_price IS NOT NULL
       AND pw.updated_at >= NOW() - INTERVAL '3 hours'
     ORDER BY pw.score DESC
     LIMIT 10`,
    [],
    { timeoutMs: 10000, label: `${LABEL}.watchlist` }
  );
  return rows || [];
}

function buildRiskWarnings(movers, setups) {
  const warnings = [];

  const lowRvol = movers.filter(m => Number(m.premarket_volume || 0) < 10000);
  if (lowRvol.length > 3) {
    warnings.push(`${lowRvol.length} symbols showing low premarket volume — wide spreads expected at open`);
  }

  if (setups.length === 0) {
    warnings.push('No ELITE or GOOD setups confirmed for today\'s session — elevated caution advised');
  }

  const avoidCount = movers.filter(m => m.execution_rating === 'AVOID').length;
  if (avoidCount > movers.length * 0.6) {
    warnings.push('Majority of watchlist rated AVOID — wait for post-open confirmation before committing');
  }

  warnings.push('Never chase extended pre-market spikes — wait for 9:30 ET open range formation');
  return warnings;
}

// ─── Email dispatch ───────────────────────────────────────────────────────────

async function getSubscriberEmails() {
  const { rows } = await queryWithTimeout(
    `SELECT email FROM newsletter_subscribers
     WHERE is_active = true
       AND email IS NOT NULL
       AND (email_preferences->>'premarket_movers')::boolean IS NOT FALSE
     LIMIT 500`,
    [],
    { timeoutMs: 8000, label: `${LABEL}.recipients` }
  ).catch(() => ({ rows: [] }));

  const emails = (rows || []).map(r => String(r.email || '').trim().toLowerCase()).filter(Boolean);

  // Always include admin fallback
  const adminFallback = String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim().toLowerCase();
  return emails.length > 0 ? Array.from(new Set(emails)) : [adminFallback];
}

async function sendEmail(subject, html, recipients) {
  const { Resend } = require('resend');
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) {
    console.warn(`${LABEL} RESEND_API_KEY not set — email skipped`);
    return { success: false, reason: 'provider-not-configured' };
  }

  const from = process.env.EMAIL_FROM || 'OpenRange <intel@openrangetrading.co.uk>';
  const response = await resend.emails.send({ from, to: recipients, subject, html });

  // Record in send history
  await queryWithTimeout(
    `INSERT INTO newsletter_send_history
       (subject, campaign_type, campaign_key, audience, recipients_count, status, sent_at)
     VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
     ON CONFLICT DO NOTHING`,
    [subject, 'premarket_brief', `premarket_${new Date().toISOString().slice(0, 10)}`, 'subscribers', recipients.length],
    { timeoutMs: 8000, label: `${LABEL}.record_history`, maxRetries: 0, poolType: 'write' }
  ).catch(() => {});

  return { success: true, response, recipients_count: recipients.length };
}

// ─── Main run function ────────────────────────────────────────────────────────

async function runPremarketBriefingEngine({ force = false } = {}) {
  const t0 = Date.now();
  console.log(`${LABEL} starting`);

  const today = new Date().toISOString().slice(0, 10);
  const campaignKey = `premarket_brief_${today}`;

  // Idempotency: skip if already sent today (unless forced)
  if (!force) {
    const { rows } = await queryWithTimeout(
      `SELECT COUNT(*) AS cnt FROM newsletter_send_history WHERE campaign_key = $1`,
      [campaignKey],
      { timeoutMs: 5000, label: `${LABEL}.dedup` }
    ).catch(() => ({ rows: [{ cnt: 1 }] })); // default to skip if db fails

    if (Number(rows[0]?.cnt || 0) > 0) {
      console.log(`${LABEL} already sent today — skipping`);
      return { ok: true, skipped: true, reason: 'already_sent_today' };
    }
  }

  // Fetch all data in parallel
  const [movers, setups, watchlist, recipients] = await Promise.all([
    fetchPremarketMovers().catch(err => { console.warn(`${LABEL} movers error:`, err.message); return []; }),
    fetchHighConvictionSetups().catch(err => { console.warn(`${LABEL} setups error:`, err.message); return []; }),
    fetchWatchlist().catch(err => { console.warn(`${LABEL} watchlist error:`, err.message); return []; }),
    getSubscriberEmails().catch(() => [String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com')]),
  ]);

  if (movers.length === 0 && setups.length === 0) {
    console.log(`${LABEL} no premarket data available — likely before session starts`);
    return { ok: true, skipped: true, reason: 'no_premarket_data' };
  }

  const warnings = buildRiskWarnings(movers, setups);
  const html = renderPremarketBriefTemplate({ movers, setups, watchlist, warnings });

  const subject = setups.length > 0
    ? `⚡ ${setups.length} High Conviction Setup${setups.length !== 1 ? 's' : ''} — OpenRange Premarket`
    : `📊 OpenRange Premarket Briefing — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })}`;

  const result = await sendEmail(subject, html, recipients);

  const ms = Date.now() - t0;
  console.log(`${LABEL} complete — movers=${movers.length} setups=${setups.length} recipients=${recipients.length} ${ms}ms`);

  return {
    ok: true,
    skipped: false,
    movers_count:  movers.length,
    setups_count:  setups.length,
    recipients:    recipients.length,
    subject,
    duration_ms:   ms,
    ...result,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startPremarketBriefingScheduler() {
  if (_timer) return;
  const cron = require('node-cron');

  // 13:00 UK weekdays (08:00 ET)
  _timer = cron.schedule('0 13 * * 1-5', () => {
    runPremarketBriefingEngine().catch(err =>
      console.error(`${LABEL} scheduled run failed:`, err.message)
    );
  }, { timezone: 'Europe/London' });

  console.log(`${LABEL} scheduler started (13:00 UK weekdays)`);
}

function stopPremarketBriefingScheduler() {
  if (_timer) { _timer.stop(); _timer = null; }
}

module.exports = {
  runPremarketBriefingEngine,
  startPremarketBriefingScheduler,
  stopPremarketBriefingScheduler,
};
