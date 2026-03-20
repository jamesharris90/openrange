function resolveDatabaseUrl() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    const error = new Error('Missing SUPABASE_DB_URL/DATABASE_URL. Server cannot start without a remote Postgres connection string.');
    error.code = 'DB_URL_MISSING';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch (_error) {
    const error = new Error('Invalid SUPABASE_DB_URL/DATABASE_URL format. Expected a valid postgresql:// URI.');
    error.code = 'DB_URL_INVALID';
    throw error;
  }

  const host = String(parsed.hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    const error = new Error(`Refusing local database host (${host}). Use Supabase remote Postgres only.`);
    error.code = 'DB_URL_LOCALHOST_FORBIDDEN';
    throw error;
  }

  process.env.DATABASE_URL = dbUrl;
  return { dbUrl, host };
}

module.exports = {
  resolveDatabaseUrl,
};
