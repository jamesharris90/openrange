import path from 'path';
import Database from 'better-sqlite3';

const provider = require('./options/yahooOptionsProvider');

const DATA_TTL_MINUTES = 15;
const NULL_TTL_MINUTES = 5;

const DATA_TTL_MS = DATA_TTL_MINUTES * 60 * 1000;
const NULL_TTL_MS = NULL_TTL_MINUTES * 60 * 1000;

const dbPath = path.join(__dirname, '..', 'db', 'options-cache.db');
const sqlite = new Database(dbPath);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS options_cache (
    symbol TEXT,
    expiration INTEGER,
    atm_iv REAL,
    expected_move_pct REAL,
    expected_move_dollar REAL,
    days_to_expiry REAL,
    null_reason TEXT,
    fetched_at DATETIME,
    PRIMARY KEY(symbol, expiration)
  );
`);

function ensureNullReasonColumn() {
  const cols = sqlite.prepare('PRAGMA table_info(options_cache)').all();
  const hasNullReason = cols.some((col: any) => String(col?.name || '').toLowerCase() === 'null_reason');
  if (!hasNullReason) {
    sqlite.exec('ALTER TABLE options_cache ADD COLUMN null_reason TEXT');
  }
}

ensureNullReasonColumn();

const getLatestCachedStmt = sqlite.prepare(`
  SELECT symbol, expiration, atm_iv, expected_move_pct, expected_move_dollar, days_to_expiry, null_reason, fetched_at
  FROM options_cache
  WHERE symbol = ?
  ORDER BY fetched_at DESC
  LIMIT 1
`);

const upsertStmt = sqlite.prepare(`
  INSERT INTO options_cache (symbol, expiration, atm_iv, expected_move_pct, expected_move_dollar, days_to_expiry, null_reason, fetched_at)
  VALUES (@symbol, @expiration, @atm_iv, @expected_move_pct, @expected_move_dollar, @days_to_expiry, @null_reason, @fetched_at)
  ON CONFLICT(symbol, expiration)
  DO UPDATE SET
    atm_iv = excluded.atm_iv,
    expected_move_pct = excluded.expected_move_pct,
    expected_move_dollar = excluded.expected_move_dollar,
    days_to_expiry = excluded.days_to_expiry,
    null_reason = excluded.null_reason,
    fetched_at = excluded.fetched_at
`);

function normalizeSymbol(symbol: unknown): string {
  return String(symbol || '').trim().toUpperCase();
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toCanonical(symbol: string, row: any, source: 'cache' | 'provider') {
  if (!row) return null;
  return {
    symbol,
    impliedMovePct: row.expectedMovePct != null ? Number(row.expectedMovePct) : null,
    impliedMoveDollar: row.expectedMoveDollar != null ? Number(row.expectedMoveDollar) : null,
    iv: row.atmIV != null ? Number(row.atmIV) : null,
    expiration: row.expiration != null ? Number(row.expiration) : null,
    strike: row.strike != null ? Number(row.strike) : null,
    daysToExpiry: row.daysToExpiry != null ? Number(row.daysToExpiry) : null,
    source,
    fetchedAt: row.fetchedAt || null,
  };
}

function parseCacheRow(row: any) {
  if (!row) return null;
  return {
    symbol: row.symbol,
    expiration: row.expiration != null ? Number(row.expiration) : null,
    atmIV: row.atm_iv != null ? Number(row.atm_iv) : null,
    expectedMovePct: row.expected_move_pct != null ? Number(row.expected_move_pct) : null,
    expectedMoveDollar: row.expected_move_dollar != null ? Number(row.expected_move_dollar) : null,
    daysToExpiry: row.days_to_expiry != null ? Number(row.days_to_expiry) : null,
    nullReason: row.null_reason || null,
    fetchedAt: row.fetched_at || null,
  };
}

function readCache(symbol: string) {
  const row = getLatestCachedStmt.get(symbol);
  const parsed = parseCacheRow(row);
  if (!parsed) return null;
  const fetchedAtMs = parsed.fetchedAt ? new Date(parsed.fetchedAt).getTime() : NaN;
  if (!Number.isFinite(fetchedAtMs)) return null;

  const ageMs = Date.now() - fetchedAtMs;
  const isNull = !!parsed.nullReason;
  const ttlMs = isNull ? NULL_TTL_MS : DATA_TTL_MS;

  return {
    parsed,
    isFresh: ageMs <= ttlMs,
    isNull,
  };
}

export function getLatestCacheBySymbol(symbol: string) {
  const safeSymbol = normalizeSymbol(symbol);
  if (!safeSymbol) return null;
  const cache = readCache(safeSymbol);
  if (!cache) return null;
  return toCanonical(safeSymbol, cache.parsed, 'cache');
}

export async function getExpectedMove(
  symbol: string,
  earningsDate?: string | null,
  context: 'earnings' | 'research' | 'screener' = 'research',
) {
  const safeSymbol = normalizeSymbol(symbol);
  if (!safeSymbol) {
    return { data: null, reason: 'invalid_symbol', source: 'provider' as const };
  }

  const cache = readCache(safeSymbol);
  if (cache?.isFresh) {
    const data = cache.isNull ? null : toCanonical(safeSymbol, cache.parsed, 'cache');
    const iv = data?.iv ?? null;
    const impliedMovePct = data?.impliedMovePct ?? null;
    console.log('[ExpectedMove]', { symbol: safeSymbol, source: 'cache', iv, impliedMovePct });
    return { data, reason: cache.isNull ? cache.parsed.nullReason : null, source: 'cache' as const };
  }

  const normalizedEarningsDate = toIsoDate(earningsDate);
  const providerResult = await provider.getExpectedMove(safeSymbol, normalizedEarningsDate);

  if (!providerResult?.data) {
    const reason = providerResult?.reason || 'unavailable';

    if (reason === 'expiration_not_found' || reason === 'iv_null' || reason === 'upstream_429') {
      try {
        upsertStmt.run({
          symbol: safeSymbol,
          expiration: 0,
          atm_iv: null,
          expected_move_pct: null,
          expected_move_dollar: null,
          days_to_expiry: null,
          null_reason: reason,
          fetched_at: new Date().toISOString(),
        });
      } catch (_error) {
      }
    }

    if (cache?.parsed && !cache.isNull) {
      const fallback = toCanonical(safeSymbol, cache.parsed, 'cache');
      console.log('[ExpectedMove]', {
        symbol: safeSymbol,
        source: 'cache',
        iv: fallback?.iv ?? null,
        impliedMovePct: fallback?.impliedMovePct ?? null,
      });
      return { data: fallback, reason, source: 'cache' as const };
    }

    console.log('[ExpectedMove]', { symbol: safeSymbol, source: 'provider', iv: null, impliedMovePct: null });
    return { data: null, reason, source: 'provider' as const };
  }

  const row = {
    symbol: safeSymbol,
    expiration: Number(providerResult.data.expiration),
    atm_iv: providerResult.data.atmIV,
    expected_move_pct: providerResult.data.expectedMovePct,
    expected_move_dollar: providerResult.data.expectedMoveDollar,
    days_to_expiry: providerResult.data.daysToExpiry,
    null_reason: null,
    fetched_at: new Date().toISOString(),
  };

  try {
    upsertStmt.run(row);
  } catch (_error) {
  }

  const data = toCanonical(safeSymbol, {
    expiration: row.expiration,
    atmIV: row.atm_iv,
    expectedMovePct: row.expected_move_pct,
    expectedMoveDollar: row.expected_move_dollar,
    daysToExpiry: row.days_to_expiry,
    fetchedAt: row.fetched_at,
    strike: null,
  }, 'provider');

  console.log('[ExpectedMove]', {
    symbol: safeSymbol,
    source: 'provider',
    iv: data?.iv ?? null,
    impliedMovePct: data?.impliedMovePct ?? null,
  });

  return { data, reason: null, source: 'provider' as const, context };
}

module.exports = {
  getExpectedMove,
  getLatestCacheBySymbol,
  DATA_TTL_MINUTES,
  NULL_TTL_MINUTES,
};