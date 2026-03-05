const logger = require('../logger');
const { pool } = require('../db/pg');

async function sendInPlatformAlert({ alertId, symbol, message }) {
  await pool.query(
    `INSERT INTO alert_history (alert_id, symbol, message)
     VALUES ($1, $2, $3)`,
    [alertId, symbol, message]
  );
  return { delivered: true, channel: 'in-platform' };
}

async function sendEmailAlert({ to, subject, text }) {
  if (!to) {
    return { delivered: false, channel: 'email', detail: 'No recipient provided' };
  }

  if (!process.env.SMTP_HOST) {
    logger.info('Email alert stub (SMTP not configured)', { to, subject, text });
    return { delivered: false, channel: 'email', detail: 'SMTP not configured' };
  }

  logger.info('Email alert queued', { to, subject, text });
  return { delivered: true, channel: 'email' };
}

module.exports = {
  sendInPlatformAlert,
  sendEmailAlert,
};
