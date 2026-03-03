import axios from 'axios';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable/batch-exchange-quote';
const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'] as const;
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface UniverseStock {
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'AMEX';
  price: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  type: string;
  isActivelyTrading: boolean;
}

type ExchangeName = typeof EXCHANGES[number];
type RawExchangeRow = Record<string, unknown>;

let universeCache: UniverseStock[] | null = null;
let cacheTimeMs = 0;

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeUpper(value: unknown): string {
  return normalizeString(value).toUpperCase();
}

function toNullableNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function looksExcludedSecurity(row: RawExchangeRow): boolean {
  const symbol = normalizeUpper(row.symbol);
  const name = normalizeUpper(row.name ?? row.companyName);
  const type = normalizeUpper(row.type ?? row.assetType ?? row.securityType);

  const tokenChecks = [
    'ETF',
    'FUND',
    'WARRANT',
    'PREFERRED',
    'RIGHT',
    'UNITS',
    'UNIT',
    'FUTURE',
  ];

  const hasToken = (text: string) => tokenChecks.some((token) => text.includes(token));

  if (hasToken(type)) return true;
  if (hasToken(name)) return true;

  if (
    symbol.endsWith('W') ||
    symbol.endsWith('WRT') ||
    symbol.endsWith('U') ||
    symbol.endsWith('R') ||
    symbol.includes('-W') ||
    symbol.includes('.W') ||
    symbol.includes('-U') ||
    symbol.includes('.U') ||
    symbol.includes('-R') ||
    symbol.includes('.R') ||
    symbol.includes('-P') ||
    symbol.includes('.P')
  ) {
    return true;
  }

  return false;
}

function normalizeExchange(row: RawExchangeRow, fallbackExchange: ExchangeName): ExchangeName | '' {
  const exchangeShort = normalizeUpper(row.exchangeShortName ?? row.exchange);
  if (exchangeShort === 'NASDAQ') return 'NASDAQ';
  if (exchangeShort === 'NYSE') return 'NYSE';
  if (exchangeShort === 'AMEX') return 'AMEX';
  return fallbackExchange;
}

function mapRow(row: RawExchangeRow, exchange: ExchangeName): UniverseStock {
  const type = normalizeString(row.type || row.assetType || row.securityType || 'stock').toLowerCase();
  const activeRaw = row.isActivelyTrading;
  const isActivelyTrading = typeof activeRaw === 'boolean'
    ? activeRaw
    : String(activeRaw ?? 'true').toLowerCase() !== 'false';

  return {
    symbol: normalizeUpper(row.symbol),
    name: normalizeString(row.name ?? row.companyName),
    exchange: normalizeExchange(row, exchange) || exchange,
    price: toNullableNumber(row.price),
    marketCap: toNullableNumber(row.marketCap),
    volume: toNullableNumber(row.volume),
    avgVolume: toNullableNumber(row.avgVolume ?? row.avgVolume3m ?? row.avgVolume20),
    type,
    isActivelyTrading,
  };
}

function filterUniverse(rows: UniverseStock[]): UniverseStock[] {
  return rows.filter((row) => {
    if (!row.symbol) return false;
    if (row.price == null) return false;

    if (row.type && row.type !== 'stock') return false;
    if (row.isActivelyTrading !== true) return false;

    if (!['NASDAQ', 'NYSE', 'AMEX'].includes(row.exchange)) return false;

    if (looksExcludedSecurity({
      symbol: row.symbol,
      name: row.name,
      type: row.type,
    })) {
      return false;
    }

    return true;
  });
}

async function fetchExchange(exchange: ExchangeName): Promise<RawExchangeRow[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY is missing');
  }

  const response = await axios.get(FMP_BASE_URL, {
    params: {
      exchange,
      apikey: apiKey,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`batch-exchange-quote failed for ${exchange} with status ${response.status}`);
  }

  if (!Array.isArray(response.data)) {
    throw new Error(`Unexpected payload for ${exchange}: expected array`);
  }

  return response.data as RawExchangeRow[];
}

async function buildUniverse(): Promise<UniverseStock[]> {
  const [nasdaqRows, nyseRows, amexRows] = await Promise.all([
    fetchExchange('NASDAQ'),
    fetchExchange('NYSE'),
    fetchExchange('AMEX'),
  ]);

  const mappedNasdaq = nasdaqRows.map((row) => mapRow(row, 'NASDAQ'));
  const mappedNyse = nyseRows.map((row) => mapRow(row, 'NYSE'));
  const mappedAmex = amexRows.map((row) => mapRow(row, 'AMEX'));

  const merged = [...mappedNasdaq, ...mappedNyse, ...mappedAmex];

  const dedupMap = new Map<string, UniverseStock>();
  for (const row of merged) {
    if (!row.symbol) continue;
    if (!dedupMap.has(row.symbol)) {
      dedupMap.set(row.symbol, row);
    }
  }

  const deduped = Array.from(dedupMap.values());
  const filtered = filterUniverse(deduped);

  console.log('[UniverseBuilderV3] NASDAQ count:', mappedNasdaq.length);
  console.log('[UniverseBuilderV3] NYSE count:', mappedNyse.length);
  console.log('[UniverseBuilderV3] AMEX count:', mappedAmex.length);
  console.log('[UniverseBuilderV3] Total before dedupe:', merged.length);
  console.log('[UniverseBuilderV3] Total after dedupe:', deduped.length);
  console.log('[UniverseBuilderV3] Total after filtering:', filtered.length);

  return filtered;
}

export async function getUniverse(): Promise<UniverseStock[]> {
  const now = Date.now();
  if (universeCache && now - cacheTimeMs < CACHE_TTL_MS) {
    return universeCache;
  }

  try {
    const built = await buildUniverse();
    universeCache = built;
    cacheTimeMs = now;
    return built;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[UniverseBuilderV3] Build failed:', message);
    throw error;
  }
}

export async function __buildUniverseForDiagnostics(): Promise<UniverseStock[]> {
  return buildUniverse();
}
