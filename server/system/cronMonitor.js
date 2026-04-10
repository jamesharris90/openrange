const fs = require('fs');
const path = require('path');

const CRON_LOG_PATH = path.resolve(__dirname, '../logs/cron.log');

function logCron(event, payload = {}) {
  const log = {
    event,
    timestamp: new Date().toISOString(),
    payload,
  };

  console.log('CRON EVENT:', log);

  fs.mkdirSync(path.dirname(CRON_LOG_PATH), { recursive: true });
  fs.appendFileSync(CRON_LOG_PATH, `${JSON.stringify(log)}\n`);
}

module.exports = { logCron };
