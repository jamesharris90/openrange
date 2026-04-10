const logger = require('../logger');

const REQUIRED_KEYS = [
  'JWT_SECRET',
  'FMP_API_KEY',
  'RESEND_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const REQUIRED_WARN_KEYS = [
  'PROXY_API_KEY',
  'ENCRYPTION_KEY',
  'FINVIZ_NEWS_TOKEN',
  'FINNHUB_API_KEY',
  'PPLX_API_KEY',
  'OPENAI_API_KEY',
];

function isMissing(value) {
  if (!value) return true;
  const normalized = String(value).trim();
  if (!normalized) return true;
  return normalized === 'REQUIRED';
}

function runEnvCheck(options = {}) {
  const { hardFail = false } = options;
  const missing = REQUIRED_KEYS.filter((key) => isMissing(process.env[key]));

  const hasDbUrl = !isMissing(process.env.SUPABASE_DB_URL) || !isMissing(process.env.DATABASE_URL);
  if (!hasDbUrl) {
    missing.push('SUPABASE_DB_URL|DATABASE_URL');
  }

  if (missing.length) {
    logger.error('Environment validation failed: required keys are missing', {
      missing,
    });

    if (hardFail) {
      const error = new Error(`Missing required environment keys: ${missing.join(', ')}`);
      error.code = 'ENV_VALIDATION_FAILED';
      error.missing = missing;
      throw error;
    }
  }

  const warningMissing = REQUIRED_WARN_KEYS.filter((key) => isMissing(process.env[key]));
  if (warningMissing.length) {
    logger.warn('Environment validation warning: recommended keys are missing', {
      missing: warningMissing,
    });
  }

  return {
    ok: missing.length === 0,
    missing,
    warningMissing,
  };
}

module.exports = {
  REQUIRED_KEYS,
  runEnvCheck,
};
