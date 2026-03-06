const logger = require('../logger');

const REQUIRED_KEYS = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_KEY',
  'PROXY_API_KEY',
];

function isMissing(value) {
  if (!value) return true;
  const normalized = String(value).trim();
  if (!normalized) return true;
  return normalized === 'REQUIRED';
}

function runEnvCheck() {
  const missing = REQUIRED_KEYS.filter((key) => isMissing(process.env[key]));

  if (missing.length) {
    logger.warn('Environment validation warning: required keys are missing', {
      missing,
    });
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

module.exports = {
  REQUIRED_KEYS,
  runEnvCheck,
};
