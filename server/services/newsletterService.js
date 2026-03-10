const { Resend } = require('resend');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureNewsletterTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.ensure_subscribers', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS newsletter_send_history (
      id BIGSERIAL PRIMARY KEY,
      subject TEXT NOT NULL,
      recipients_count INTEGER NOT NULL DEFAULT 0,
      provider_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      open_rate NUMERIC NOT NULL DEFAULT 0,
      click_rate NUMERIC NOT NULL DEFAULT 0,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_unique_idx
     ON newsletter_subscribers (email)`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.ensure_subscriber_email_index', maxRetries: 0 }
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

  const { rows } = await queryWithTimeout(
    `SELECT email
     FROM newsletter_subscribers
     WHERE is_active = TRUE
     ORDER BY created_at DESC`,
    [],
    { timeoutMs: 7000, label: 'newsletter_service.load_subscribers', maxRetries: 0 }
  );

  const recipients = rows.map((row) => String(row.email || '').trim()).filter(Boolean);
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

  await queryWithTimeout(
    `INSERT INTO newsletter_send_history (
       subject,
       recipients_count,
       provider_id,
       status,
       open_rate,
       click_rate,
       sent_at,
       created_at
     ) VALUES ($1, $2, $3, $4, 0, 0, NOW(), NOW())`,
    [subject, recipients.length, response?.data?.id || null, 'sent'],
    { timeoutMs: 7000, label: 'newsletter_service.record_send_history', maxRetries: 0 }
  );

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
  sendPremarketNewsletter,
  ensureNewsletterTables,
};
