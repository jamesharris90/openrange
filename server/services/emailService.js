const { Resend } = require('resend');
const logger = require('../logger');

function getRecipients() {
  const configured = String(process.env.MORNING_BRIEF_RECIPIENTS || process.env.RESEND_TO || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured;
}

function buildBriefingHtml(briefing) {
  const createdAt = briefing?.createdAt || new Date().toISOString();
  const narrative = briefing?.narrative || {};
  const signals = Array.isArray(briefing?.signals) ? briefing.signals : [];
  const market = Array.isArray(briefing?.market) ? briefing.market : [];
  const news = Array.isArray(briefing?.news) ? briefing.news : [];

  const signalRows = signals
    .slice(0, 8)
    .map((row) => `<li><strong>${row.symbol || 'N/A'}</strong> ${row.strategy || 'strategy'} (score: ${row.score || 'n/a'})</li>`)
    .join('');
  const marketRows = market
    .slice(0, 8)
    .map((row) => `<li><strong>${row.symbol || 'N/A'}</strong> ${row.price || 'n/a'} (${row.change_percent || 0}%)</li>`)
    .join('');
  const newsRows = news
    .slice(0, 8)
    .map((row) => `<li>${row.headline || 'Untitled'} (${row.source || 'source n/a'})</li>`)
    .join('');

  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; line-height:1.5; color:#12263a;">
      <h2>OpenRange Morning Briefing</h2>
      <p><strong>Generated:</strong> ${createdAt}</p>
      <h3>Overview</h3>
      <p>${narrative.overview || 'No overview generated.'}</p>
      <h3>Risk</h3>
      <p>${narrative.risk || 'No risk summary generated.'}</p>
      <h3>Catalysts</h3>
      <ul>${(narrative.catalysts || []).map((item) => `<li>${item}</li>`).join('')}</ul>
      <h3>Watchlist</h3>
      <ul>${(narrative.watchlist || []).map((item) => `<li>${item}</li>`).join('')}</ul>
      <h3>Top Signals</h3>
      <ul>${signalRows}</ul>
      <h3>Market Snapshot</h3>
      <ul>${marketRows}</ul>
      <h3>News Pulse</h3>
      <ul>${newsRows}</ul>
    </div>
  `;
}

function buildBriefingText(briefing) {
  const narrative = briefing?.narrative || {};
  const signalList = (briefing?.signals || [])
    .slice(0, 6)
    .map((row) => `${row.symbol || 'N/A'} (${row.score || 'n/a'})`)
    .join(', ');

  return [
    'OpenRange Morning Briefing',
    `Generated: ${briefing?.createdAt || new Date().toISOString()}`,
    '',
    `Overview: ${narrative.overview || 'No overview generated.'}`,
    `Risk: ${narrative.risk || 'No risk summary generated.'}`,
    `Watchlist: ${(narrative.watchlist || []).join(', ') || 'None'}`,
    `Top Signals: ${signalList || 'None'}`,
  ].join('\n');
}

async function sendBriefingEmail(briefing, recipientOverride) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('[BRIEFING_EMAIL] RESEND_API_KEY missing; skipping email send');
    return { sent: false, reason: 'missing_resend_api_key' };
  }

  const recipients = recipientOverride ? [recipientOverride] : getRecipients();
  if (!recipients.length) {
    logger.warn('[BRIEFING_EMAIL] No recipients configured; skipping email send');
    return { sent: false, reason: 'missing_recipients' };
  }

  const from = process.env.EMAIL_FROM || 'OpenRange <briefing@openrange.local>';
  const resend = new Resend(apiKey);

  const response = await resend.emails.send({
    from,
    to: recipients,
    subject: `OpenRange Morning Briefing - ${new Date().toISOString().slice(0, 10)}`,
    html: buildBriefingHtml(briefing),
    text: buildBriefingText(briefing),
  });

  console.log('EMAIL RESPONSE:', response);

  logger.info('[BRIEFING_EMAIL] Sent', {
    recipients,
    rawResponse: response,
    id: response?.data?.id || null,
  });

  return {
    sent: true,
    recipients,
    providerId: response?.data?.id || null,
  };
}

module.exports = {
  sendBriefingEmail,
};
