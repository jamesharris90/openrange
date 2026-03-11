const axios = require('axios');
const logger = require('../logger');

const DISPATCHABLE = new Set(['high', 'critical']);

async function dispatchToConsole(alert) {
  logger.warn('OPENRANGE ALERT', {
    type: alert.type,
    source: alert.source,
    severity: alert.severity,
    message: alert.message,
    created_at: alert.created_at,
  });
}

async function dispatchToEmail(alert) {
  if (!process.env.ALERT_EMAIL) return { enabled: false };
  logger.warn('[ALERT_EMAIL] simulated dispatch', {
    to: process.env.ALERT_EMAIL,
    subject: `OPENRANGE ALERT: ${alert.type}`,
    body: `${alert.message} (${alert.source})`,
  });
  return { enabled: true };
}

async function dispatchToWebhook(alert) {
  const webhook = process.env.ALERT_WEBHOOK;
  if (!webhook) return { enabled: false };

  await axios.post(
    webhook,
    {
      title: 'OPENRANGE ALERT',
      type: alert.type,
      source: alert.source,
      severity: alert.severity,
      message: alert.message,
      created_at: alert.created_at,
    },
    { timeout: 5000 }
  );

  return { enabled: true };
}

async function dispatchAlert(alert) {
  const severity = String(alert?.severity || '').toLowerCase();
  if (!DISPATCHABLE.has(severity)) {
    return { ok: true, skipped: true };
  }

  await dispatchToConsole(alert);

  try {
    await Promise.allSettled([dispatchToEmail(alert), dispatchToWebhook(alert)]);
    return { ok: true, skipped: false };
  } catch (error) {
    logger.error('[ENGINE ERROR] alert dispatch failed', { error: error.message, type: alert?.type });
    return { ok: false, skipped: false, error: error.message };
  }
}

module.exports = {
  dispatchAlert,
};
