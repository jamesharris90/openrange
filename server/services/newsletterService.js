const { Resend } = require('resend');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const EMAIL_TYPES = {
  MORNING_BEACON_BRIEF: 'morning_beacon_brief',
  PREMARKET_MOVERS: 'premarket_movers',
  SECTOR_ROTATION_UPDATE: 'sector_rotation_update',
  EVENING_REVIEW: 'evening_review',
  HIGH_CONVICTION_ALERTS: 'high_conviction_alerts',
};

function defaultEmailPreferences() {
  return {
    [EMAIL_TYPES.MORNING_BEACON_BRIEF]: true,
    [EMAIL_TYPES.PREMARKET_MOVERS]: true,
    [EMAIL_TYPES.SECTOR_ROTATION_UPDATE]: false,
    [EMAIL_TYPES.EVENING_REVIEW]: false,
    [EMAIL_TYPES.HIGH_CONVICTION_ALERTS]: false,
  };
}

function normalizeEmailPreferences(rawPrefs = {}) {
  const defaults = defaultEmailPreferences();
  const input = rawPrefs && typeof rawPrefs === 'object' ? rawPrefs : {};

  return Object.keys(defaults).reduce((acc, key) => {
    acc[key] = input[key] === undefined ? defaults[key] : Boolean(input[key]);
    return acc;
  }, {});
}

function parsePreferences(rawValue) {
  if (!rawValue) return defaultEmailPreferences();
  if (typeof rawValue === 'object') return normalizeEmailPreferences(rawValue);

  try {
    return normalizeEmailPreferences(JSON.parse(rawValue));
  } catch (_error) {
    return defaultEmailPreferences();
  }
}

function normalizeEmailType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (Object.values(EMAIL_TYPES).includes(type)) return type;
  return EMAIL_TYPES.MORNING_BEACON_BRIEF;
}

async function ensureNewsletterTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      timezone TEXT,
      email_preferences JSONB NOT NULL DEFAULT '{"morning_beacon_brief":true,"premarket_movers":true,"sector_rotation_update":false,"evening_review":false,"high_conviction_alerts":false}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.ensure_subscribers', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS newsletter_send_history (
      id BIGSERIAL PRIMARY KEY,
      subject TEXT NOT NULL,
      campaign_type TEXT NOT NULL DEFAULT 'newsletter',
      campaign_key TEXT,
      audience TEXT,
      recipients_count INTEGER NOT NULL DEFAULT 0,
      provider_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      open_rate NUMERIC NOT NULL DEFAULT 0,
      click_rate NUMERIC NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.ensure_send_history', maxRetries: 0 }
  );

  // Backward-compatible schema upgrades for environments with pre-existing tables.
  await queryWithTimeout(
    `ALTER TABLE newsletter_subscribers
       ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_subscribers_is_active', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_subscribers
       ADD COLUMN IF NOT EXISTS timezone TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_subscribers_timezone', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_subscribers
       ADD COLUMN IF NOT EXISTS email_preferences JSONB NOT NULL DEFAULT '{"morning_beacon_brief":true,"premarket_movers":true,"sector_rotation_update":false,"evening_review":false,"high_conviction_alerts":false}'::jsonb`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_subscribers_email_preferences', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_subscribers
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_subscribers_updated_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE newsletter_subscribers
     SET email_preferences = '{"morning_beacon_brief":true,"premarket_movers":true,"sector_rotation_update":false,"evening_review":false,"high_conviction_alerts":false}'::jsonb
     WHERE email_preferences IS NULL`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.backfill_subscriber_preferences', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_unique_idx
     ON newsletter_subscribers (email)`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.ensure_subscriber_email_index', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'newsletter'`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_campaign_type', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS campaign_key TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_campaign_key', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS audience TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_audience', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_metadata', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS open_rate NUMERIC NOT NULL DEFAULT 0`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_open_rate', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS click_rate NUMERIC NOT NULL DEFAULT 0`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_click_rate', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_status', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE newsletter_send_history
       ADD COLUMN IF NOT EXISTS provider_id TEXT`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.alter_send_history_provider_id', maxRetries: 0 }
  );
}

async function getSubscriberPreferencesByEmail(email) {
  await ensureNewsletterTables();
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  const { rows } = await queryWithTimeout(
    `SELECT email, is_active, timezone, email_preferences, created_at, updated_at
     FROM newsletter_subscribers
     WHERE email = $1
     LIMIT 1`,
    [target],
    { timeoutMs: 7000, label: 'newsletter_service.get_subscriber_preferences', maxRetries: 0 }
  );

  const row = rows?.[0];
  if (!row) return null;

  return {
    email: row.email,
    isActive: Boolean(row.is_active),
    timezone: row.timezone || null,
    emailPreferences: parsePreferences(row.email_preferences),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function upsertSubscriberPreferences({
  email,
  enabled,
  timezone,
  emailPreferences,
}) {
  await ensureNewsletterTables();

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const isActive = enabled === undefined ? true : Boolean(enabled);
  const normalizedTimezone = timezone ? String(timezone).trim() : null;
  const mergedPreferences = normalizeEmailPreferences(emailPreferences);

  await queryWithTimeout(
    `INSERT INTO newsletter_subscribers (
       email,
       is_active,
       timezone,
       email_preferences,
       updated_at,
       created_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4::jsonb,
       NOW(),
       NOW()
     )
     ON CONFLICT (email)
     DO UPDATE SET
       is_active = EXCLUDED.is_active,
       timezone = EXCLUDED.timezone,
       email_preferences = EXCLUDED.email_preferences,
       updated_at = NOW()`,
    [normalizedEmail, isActive, normalizedTimezone, JSON.stringify(mergedPreferences)],
    { timeoutMs: 7000, label: 'newsletter_service.upsert_subscriber_preferences', maxRetries: 0 }
  );

  return getSubscriberPreferencesByEmail(normalizedEmail);
}

async function unsubscribeEmail({ email, emailType }) {
  await ensureNewsletterTables();

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const current = await getSubscriberPreferencesByEmail(normalizedEmail);
  if (!current) return null;

  if (!emailType) {
    await queryWithTimeout(
      `UPDATE newsletter_subscribers
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE email = $1`,
      [normalizedEmail],
      { timeoutMs: 7000, label: 'newsletter_service.unsubscribe_global', maxRetries: 0 }
    );
  } else {
    const nextPrefs = {
      ...current.emailPreferences,
      [normalizeEmailType(emailType)]: false,
    };

    await queryWithTimeout(
      `UPDATE newsletter_subscribers
       SET email_preferences = $2::jsonb,
           updated_at = NOW()
       WHERE email = $1`,
      [normalizedEmail, JSON.stringify(normalizeEmailPreferences(nextPrefs))],
      { timeoutMs: 7000, label: 'newsletter_service.unsubscribe_email_type', maxRetries: 0 }
    );
  }

  return getSubscriberPreferencesByEmail(normalizedEmail);
}

async function resolveSubscribedRecipients(options = {}) {
  await ensureNewsletterTables();

  const emailType = normalizeEmailType(options.emailType);
  const includeStaticRecipients = Array.isArray(options.includeStaticRecipients)
    ? options.includeStaticRecipients
    : [];

  const { rows } = await queryWithTimeout(
    `SELECT email, email_preferences
     FROM newsletter_subscribers
     WHERE is_active = TRUE
     ORDER BY created_at DESC`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.resolve_subscribers', maxRetries: 0 }
  );

  const optedIn = (rows || [])
    .filter((row) => {
      const prefs = parsePreferences(row.email_preferences);
      return prefs[emailType] === true;
    })
    .map((row) => String(row.email || '').trim().toLowerCase())
    .filter(Boolean);

  const staticRecipients = includeStaticRecipients
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...optedIn, ...staticRecipients]));
}

async function recordNewsletterSendHistory(entry = {}) {
  await ensureNewsletterTables();

  const subject = String(entry.subject || 'OpenRange Newsletter').slice(0, 400);
  const recipientsCount = Number.isFinite(Number(entry.recipientsCount)) ? Number(entry.recipientsCount) : 0;
  const providerId = entry.providerId ? String(entry.providerId) : null;
  const status = String(entry.status || 'sent');
  const campaignType = String(entry.campaignType || 'newsletter');
  const campaignKey = entry.campaignKey ? String(entry.campaignKey) : null;
  const audience = entry.audience ? String(entry.audience) : null;
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};

  await queryWithTimeout(
    `INSERT INTO newsletter_send_history (
       subject,
       campaign_type,
       campaign_key,
       audience,
       recipients_count,
       provider_id,
       status,
       open_rate,
       click_rate,
       metadata,
       sent_at,
       created_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       0,
       0,
       $8::jsonb,
       NOW(),
       NOW()
     )`,
    [
      subject,
      campaignType,
      campaignKey,
      audience,
      recipientsCount,
      providerId,
      status,
      JSON.stringify(metadata),
    ],
    { timeoutMs: 7000, label: 'newsletter_service.record_send_history', maxRetries: 0 }
  );
}

function buildHtml(payload) {
  const topSignals = Array.isArray(payload?.topSignals) ? payload.topSignals : [];
  const catalysts = Array.isArray(payload?.topCatalysts) ? payload.topCatalysts : [];
  const sectors = Array.isArray(payload?.sectorLeaders) ? payload.sectorLeaders : [];
  const narrative = String(payload?.marketNarrative || 'No market narrative available.');

  const signalRows = topSignals.map((row) => (
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #1f2937;">${row.symbol || 'N/A'}</td><td style="padding:6px 8px;border-bottom:1px solid #1f2937;">${Number(row.score || 0).toFixed(2)}</td><td style="padding:6px 8px;border-bottom:1px solid #1f2937;">${row.confidence || 'N/A'}</td></tr>`
  )).join('') || '<tr><td colspan="3" style="padding:6px 8px;">No top signals available.</td></tr>';

  const catalystRows = catalysts.map((row) => (`<li>${row.symbol || 'N/A'} - ${row.catalyst_type || 'unknown'}</li>`)).join('') || '<li>No catalysts available.</li>';
  const sectorRows = sectors.map((row) => (`<li>${row.sector || 'Unknown'} - ${Number(row.momentum_score || 0).toFixed(2)}</li>`)).join('') || '<li>No sector leaders available.</li>';

  return `
    <div style="font-family:Arial,sans-serif;background:#0b1220;color:#e2e8f0;padding:18px;">
      <h2 style="margin:0 0 12px 0;color:#38bdf8;">OpenRange Premarket Intelligence Brief</h2>
      <h3 style="margin:14px 0 8px 0;">Top Signals</h3>
      <table style="width:100%;border-collapse:collapse;background:#111827;">
        <thead>
          <tr><th style="padding:6px 8px;text-align:left;">Symbol</th><th style="padding:6px 8px;text-align:left;">Score</th><th style="padding:6px 8px;text-align:left;">Confidence</th></tr>
        </thead>
        <tbody>${signalRows}</tbody>
      </table>
      <h3 style="margin:14px 0 8px 0;">Key Catalysts</h3>
      <ul>${catalystRows}</ul>
      <h3 style="margin:14px 0 8px 0;">Sector Leaders</h3>
      <ul>${sectorRows}</ul>
      <h3 style="margin:14px 0 8px 0;">Market Narrative</h3>
      <p style="line-height:1.5;">${narrative}</p>
    </div>
  `;
}

function buildText(payload) {
  const topSignals = Array.isArray(payload?.topSignals) ? payload.topSignals : [];
  const catalysts = Array.isArray(payload?.topCatalysts) ? payload.topCatalysts : [];
  const sectors = Array.isArray(payload?.sectorLeaders) ? payload.sectorLeaders : [];

  return [
    'OpenRange Premarket Intelligence Brief',
    '',
    'Top Signals:',
    ...topSignals.map((row) => `${row.symbol || 'N/A'} | Score ${Number(row.score || 0).toFixed(2)} | Confidence ${row.confidence || 'N/A'}`),
    '',
    'Key Catalysts:',
    ...catalysts.map((row) => `${row.symbol || 'N/A'} | ${row.catalyst_type || 'unknown'}`),
    '',
    'Sector Leaders:',
    ...sectors.map((row) => `${row.sector || 'Unknown'} | ${Number(row.momentum_score || 0).toFixed(2)}`),
    '',
    `Market Narrative: ${String(payload?.marketNarrative || 'No market narrative available.')}`,
  ].join('\n');
}

async function sendPremarketNewsletter(payload) {
  await ensureNewsletterTables();

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: 'missing_resend_api_key', recipients: 0 };
  }

  const recipients = await resolveSubscribedRecipients({ emailType: EMAIL_TYPES.PREMARKET_MOVERS });
  if (!recipients.length) {
    return { sent: false, reason: 'no_subscribers', recipients: 0 };
  }

  const resend = new Resend(apiKey);
  const subject = 'OpenRange Premarket Intelligence Brief';
  const response = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'OpenRange <briefing@openrange.local>',
    to: recipients,
    subject,
    html: buildHtml(payload),
    text: buildText(payload),
  });

  await recordNewsletterSendHistory({
    subject,
    campaignType: 'newsletter',
    campaignKey: `newsletter:${new Date().toISOString().slice(0, 10)}`,
    audience: EMAIL_TYPES.PREMARKET_MOVERS,
    recipientsCount: recipients.length,
    providerId: response?.data?.id || null,
    status: 'sent',
    metadata: {
      topSignals: Array.isArray(payload?.topSignals) ? payload.topSignals.length : 0,
    },
  });

  logger.info('[NEWSLETTER] sent', {
    recipients: recipients.length,
    providerId: response?.data?.id || null,
  });

  return {
    sent: true,
    recipients: recipients.length,
    providerId: response?.data?.id || null,
  };
}

module.exports = {
  EMAIL_TYPES,
  defaultEmailPreferences,
  normalizeEmailPreferences,
  sendPremarketNewsletter,
  ensureNewsletterTables,
  getSubscriberPreferencesByEmail,
  upsertSubscriberPreferences,
  unsubscribeEmail,
  resolveSubscribedRecipients,
  recordNewsletterSendHistory,
};
