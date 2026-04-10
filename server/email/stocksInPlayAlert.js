const { Resend } = require('resend');
const logger = require('../logger');
const newsletterService = require('../services/newsletterService');
const { generateBeaconMorningPayload } = require('./beaconMorningBrief');
const { renderBeaconMorningTemplate } = require('./templates/BeaconMorningTemplate');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'OpenRange <intel@openrangetrading.co.uk>';

function todayKey(prefix) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${prefix}_${y}${m}${day}`;
}

async function resolveRecipients(forceTo = null) {
  if (forceTo) {
    return [String(forceTo).trim().toLowerCase()];
  }

  const recipients = await newsletterService.resolveSubscribedRecipients({
    emailType: 'morningBrief',
    fallbackToLegacy: true,
  }).catch(() => []);

  if (Array.isArray(recipients) && recipients.length > 0) {
    return recipients;
  }

  return [String(process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim().toLowerCase()];
}

async function sendStocksInPlayAlert({ force = false, forceTo = null, campaignKey = null } = {}) {
  const key = campaignKey || `${todayKey('stocks_in_play')}_${Date.now()}`;

  try {
    if (!resend) {
      return { success: false, reason: 'provider-not-configured', campaignKey: key };
    }

    const payload = await generateBeaconMorningPayload({ limit: 3 });
    const majorSetups = (payload.stocksInPlay || []).filter((row) => Number(row.tradeScore || 0) >= 80);

    if (!force && majorSetups.length === 0) {
      return { success: true, skipped: true, reason: 'no_major_setups', campaignKey: key };
    }

    const focus = majorSetups[0] || payload.stockOfDay || (payload.stocksInPlay || [])[0] || null;
    const symbol = String(focus?.symbol || 'Setup').toUpperCase();
    const narrative = focus?.narrative || {};
    const tradeScore = Number.isFinite(Number(focus?.tradeScore)) ? Math.round(Number(focus.tradeScore)) : 'N/A';
    const confidence = String(focus?.confidence || 'Low');
    const probabilityContext = String(focus?.probabilityContext || 'Historical performance data unavailable')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('<br />');
    const chart = focus?.chartImage || focus?.chartUrl || 'https://openrangetrading.co.uk/charts';

    const html = focus
      ? `
        <div style="font-family:Arial,sans-serif;background:#020617;color:#e2e8f0;padding:18px;">
          <h2 style="margin:0 0 10px 0;color:#38bdf8;">A+ Setup Detected - ${symbol}</h2>
          <div style="margin-bottom:10px;font-size:13px;">Trade score: <strong>${tradeScore}</strong></div>
          <div style="margin-bottom:10px;font-size:13px;">Confidence: <strong>${confidence}</strong></div>
          <div style="margin-bottom:10px;font-size:13px;padding:10px;border:1px solid #1f2937;border-radius:8px;background:#0b1220;">${probabilityContext}</div>
          <div style="margin-bottom:10px;font-size:13px;"><strong>Entry trigger:</strong> ${narrative.howToTrade || 'Wait for confirmation above key level.'}</div>
          <div style="margin-bottom:10px;font-size:13px;"><strong>Risk:</strong> ${narrative.risk || 'Define invalidation before entry.'}</div>
          <div style="margin-bottom:10px;font-size:13px;"><strong>Target:</strong> ${narrative.target || 'Scale at 1R and trail.'}</div>
          <a href="https://openrangetrading.co.uk/radar?symbol=${encodeURIComponent(symbol)}" style="display:inline-block;background:#38bdf8;color:#0b1220;text-decoration:none;padding:9px 12px;border-radius:8px;font-weight:700;margin-bottom:10px;">Open in Radar</a>
          <div><img src="${chart}" alt="${symbol} chart" style="width:100%;border-radius:8px;border:1px solid #1f2937;" /></div>
        </div>
      `
      : renderBeaconMorningTemplate({
        ...payload,
        title: 'OpenRange Stocks In Play Alert',
        preheader: 'High conviction setups detected near market open',
      });

    const recipients = await resolveRecipients(forceTo);

    const response = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject: `A+ Setup Detected - ${symbol}`,
      html,
    });

    return {
      success: true,
      recipients,
      response,
      campaignKey: key,
      type: 'stocksInPlay',
    };
  } catch (error) {
    logger.warn('[STOCKS_IN_PLAY_ALERT] send failure', { message: error?.message || String(error) });
    return {
      success: false,
      reason: 'send-failure',
      error: error?.message || String(error),
      campaignKey: key,
      type: 'stocksInPlay',
    };
  }
}

module.exports = {
  sendStocksInPlayAlert,
};
