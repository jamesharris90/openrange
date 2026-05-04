/*
node server/scripts/viewPicks.js                  # default review
node server/scripts/viewPicks.js --label A        # only A-labels
node server/scripts/viewPicks.js --min-price 5 --max-price 60 --min-rvol 3
node server/scripts/viewPicks.js --since 2026-05-04T13:30:00Z --winners-only --min-t4 5
node server/scripts/viewPicks.js --catalyst earnings --min-gap 4
node server/scripts/viewPicks.js --symbol BKNG    # detail view
node server/scripts/viewPicks.js --label A --json | jq
*/

const fs = require('fs');
const path = require('path');

const earlyJsonMode = process.argv.slice(2).includes('--json');

if (earlyJsonMode) {
  console.log = (...args) => process.stderr.write(`${args.join(' ')}\n`);
  console.warn = (...args) => process.stderr.write(`${args.join(' ')}\n`);
  console.info = (...args) => process.stderr.write(`${args.join(' ')}\n`);
}

require('../node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const useColor = process.stdout.isTTY;
const DEFAULT_RECENT_HOURS = 2;
const DEFAULT_OUTCOME_HOURS = 24;
const DEFAULT_B_LIMIT = 20;
const EXCLUDE_FILE_PATH = path.join(__dirname, '.viewpicks-exclude');
const VALID_LABEL_ARGS = new Set(['A', 'B', 'C', 'AB']);
const VALID_SECTION_LABELS = new Set(['A', 'B', 'C']);
const VALID_DIRECTIONS = new Set(['up', 'down', 'both']);

let queryWithTimeout = null;
let CliTable = null;

try {
  require.resolve('cli-table3');
  CliTable = require('cli-table3');
} catch (_error) {
  CliTable = null;
}

const HELP_TEXT = `Usage:
  node server/scripts/viewPicks.js [options]

Examples:
  node server/scripts/viewPicks.js
  node server/scripts/viewPicks.js --label A
  node server/scripts/viewPicks.js --min-price 5 --max-price 60 --min-mc 200M --max-mc 10B --min-rvol 3
  node server/scripts/viewPicks.js --since 2026-05-04T13:30:00Z --winners-only --min-t4 5
  node server/scripts/viewPicks.js --catalyst earnings --min-gap 4
  node server/scripts/viewPicks.js --symbol BKNG
  node server/scripts/viewPicks.js --label A --json | jq

View:
  --help, -h                  Show this help text
  --since <ISO>               Only use picks generated after this time
  --json                      Output JSON instead of tables
  --symbol <SYM>              Show full detail for one symbol

Price:
  --min-price <n>             Minimum pick price
  --max-price <n>             Maximum pick price

Market Cap:
  --min-mc <value>            Minimum market cap, e.g. 100M, 1.5B, 1000000000
  --max-mc <value>            Maximum market cap, e.g. 10B

Volume / RVOL:
  --min-premarket-volume <n>  Minimum premarket volume
  --min-rvol <n>              Minimum RVOL, e.g. 3 means 3x+

Gap:
  --min-gap <n>               Minimum absolute gap percent
  --max-gap <n>               Maximum absolute gap percent
  --direction <up|down|both>  Gap direction filter, default both

Label / Score:
  --label <A|B|C|AB>          Labels to render, default AB
  --min-score <n>             Minimum score
  --limit <n>                 Max picks per section; A stays unlimited unless set

Symbol:
  --exclude <SYM,SYM>         Exclude symbols, additive to .viewpicks-exclude
  --include <SYM,SYM>         Re-include excluded symbols
  --only <SYM,SYM>            Only show these symbols

Catalyst:
  --catalyst <type,type>      Filter catalyst types, e.g. earnings,fda,mna
  --has-catalyst              Require catalyst_score > 0

Risk Flags:
  --exclude-flag <flag,flag>  Hide picks with any listed risk flag
  --require-flag <flag>       Only show picks with this risk flag

Outcomes:
  --min-t1 <n>                Minimum T1 pct change
  --max-t1 <n>                Maximum T1 pct change
  --min-t2 <n>                Minimum T2 pct change
  --max-t2 <n>                Maximum T2 pct change
  --min-t4 <n>                Minimum T4 pct change
  --max-t4 <n>                Maximum T4 pct change
  --winners-only              Only picks with positive T4 outcome
  --losers-only               Only picks with negative T4 outcome
  --complete-only             Only picks with outcome_status=complete
`;

function getQueryWithTimeout() {
  if (!queryWithTimeout) {
    ({ queryWithTimeout } = require('../db/pg'));
  }
  return queryWithTimeout;
}

function writeLine(value = '') {
  process.stdout.write(`${value}\n`);
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
}

function stripAnsi(value) {
  return String(value == null ? '' : value).replace(/\x1b\[[0-9;]*m/g, '');
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeListToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function splitCommaList(value, normalizer = (item) => item) {
  return String(value || '')
    .split(',')
    .map((item) => normalizer(item))
    .filter(Boolean);
}

function parseNumberArg(flag, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${flag} requires a numeric value`);
  }
  return numeric;
}

function parseIntegerArg(flag, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${flag} requires a numeric value`);
  }
  return Math.trunc(numeric);
}

function parseMarketCapValue(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error('market cap value is required');
  }

  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([MBT])?$/i);
  if (!match) {
    throw new Error(`Invalid market cap value: ${value}`);
  }

  const numeric = Number(match[1]);
  const suffix = String(match[2] || '').toUpperCase();
  const multiplier = suffix === 'M'
    ? 1_000_000
    : suffix === 'B'
      ? 1_000_000_000
      : suffix === 'T'
        ? 1_000_000_000_000
        : 1;

  return Math.trunc(numeric * multiplier);
}

function formatNumber(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(digits);
}

function formatSignedPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  const prefix = numeric > 0 ? '+' : '';
  const rendered = `${prefix}${numeric.toFixed(2)}%`;
  if (!useColor || numeric === 0) return rendered;
  return numeric > 0 ? `${GREEN}${rendered}${RESET}` : `${RED}${rendered}${RESET}`;
}

function formatRvol(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${numeric.toFixed(1)}x`;
}

function formatPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toFixed(2);
}

function formatMarketCap(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  if (numeric >= 1_000_000_000_000) {
    return `$${(numeric / 1_000_000_000_000).toFixed(1)}T`;
  }
  if (numeric >= 1_000_000_000) {
    return `$${(numeric / 1_000_000_000).toFixed(1)}B`;
  }
  if (numeric >= 1_000_000) {
    return `$${(numeric / 1_000_000).toFixed(0)}M`;
  }
  return `$${numeric.toFixed(0)}`;
}

function formatTimestamp(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function formatBooleanArrow(value) {
  if (value === true) return '↑';
  if (value === false) return '↓';
  return '-';
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return value ? [value] : [];
    }
  }
  return [];
}

function getTableOutput(columns, rows) {
  const normalizedRows = rows.map((row) => columns.map((column) => String(row[column.key] == null ? '-' : row[column.key])));

  if (CliTable) {
    const table = new CliTable({
      head: columns.map((column) => column.label),
      style: { head: [], border: [] },
      wordWrap: true,
    });

    normalizedRows.forEach((row) => table.push(row));
    return table.toString();
  }

  const widths = columns.map((column, index) => {
    const rowWidths = normalizedRows.map((row) => stripAnsi(row[index]).length);
    return Math.max(stripAnsi(column.label).length, ...rowWidths, 4);
  });

  const renderRow = (cells) => cells
    .map((cell, index) => {
      const visibleLength = stripAnsi(cell).length;
      return `${cell}${' '.repeat(Math.max(0, widths[index] - visibleLength))}`;
    })
    .join('  ');

  const header = renderRow(columns.map((column) => column.label));
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = normalizedRows.map(renderRow);
  return [header, divider, ...body].join('\n');
}

function printSection(title, columns, rows, emptyMessage = '(none)') {
  writeLine(`\n${title}`);
  if (!rows || rows.length === 0) {
    writeLine(emptyMessage);
    return;
  }
  writeLine(getTableOutput(columns, rows));
}

function parseArgs(argv) {
  const options = {
    help: false,
    json: false,
    since: null,
    label: 'AB',
    symbol: null,
    filters: {
      minPrice: null,
      maxPrice: null,
      minMarketCap: null,
      maxMarketCap: null,
      minPremarketVolume: null,
      minRvol: null,
      minGap: null,
      maxGap: null,
      direction: 'both',
      minScore: null,
      limit: null,
      excludeSymbols: [],
      includeSymbols: [],
      onlySymbols: [],
      catalystTypes: [],
      hasCatalyst: false,
      excludeFlags: [],
      requireFlag: null,
      minT1: null,
      maxT1: null,
      minT2: null,
      maxT2: null,
      minT4: null,
      maxT4: null,
      winnersOnly: false,
      losersOnly: false,
      completeOnly: false,
    },
  };

  const requireValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--since': {
        const value = requireValue(arg, index);
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error(`Invalid --since timestamp: ${value}`);
        }
        options.since = parsed.toISOString();
        index += 1;
        break;
      }
      case '--label': {
        const value = String(requireValue(arg, index)).trim().toUpperCase();
        if (!VALID_LABEL_ARGS.has(value)) {
          throw new Error('--label must be one of A, B, C, or AB');
        }
        options.label = value;
        index += 1;
        break;
      }
      case '--symbol': {
        const value = normalizeSymbol(requireValue(arg, index));
        if (!value) {
          throw new Error('--symbol requires a ticker');
        }
        options.symbol = value;
        index += 1;
        break;
      }
      case '--min-price':
        options.filters.minPrice = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--max-price':
        options.filters.maxPrice = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--min-mc':
        options.filters.minMarketCap = parseMarketCapValue(requireValue(arg, index));
        index += 1;
        break;
      case '--max-mc':
        options.filters.maxMarketCap = parseMarketCapValue(requireValue(arg, index));
        index += 1;
        break;
      case '--min-premarket-volume':
        options.filters.minPremarketVolume = parseIntegerArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--min-rvol':
        options.filters.minRvol = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--min-gap':
        options.filters.minGap = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--max-gap':
        options.filters.maxGap = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--direction': {
        const value = String(requireValue(arg, index)).trim().toLowerCase();
        if (!VALID_DIRECTIONS.has(value)) {
          throw new Error('--direction must be up, down, or both');
        }
        options.filters.direction = value;
        index += 1;
        break;
      }
      case '--min-score':
        options.filters.minScore = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--limit':
        options.filters.limit = parseIntegerArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--exclude':
        options.filters.excludeSymbols = splitCommaList(requireValue(arg, index), normalizeSymbol);
        index += 1;
        break;
      case '--include':
        options.filters.includeSymbols = splitCommaList(requireValue(arg, index), normalizeSymbol);
        index += 1;
        break;
      case '--only':
        options.filters.onlySymbols = splitCommaList(requireValue(arg, index), normalizeSymbol);
        index += 1;
        break;
      case '--catalyst':
        options.filters.catalystTypes = splitCommaList(requireValue(arg, index), normalizeListToken);
        index += 1;
        break;
      case '--has-catalyst':
        options.filters.hasCatalyst = true;
        break;
      case '--exclude-flag':
        options.filters.excludeFlags = splitCommaList(requireValue(arg, index), normalizeListToken);
        index += 1;
        break;
      case '--require-flag':
        options.filters.requireFlag = normalizeListToken(requireValue(arg, index));
        index += 1;
        break;
      case '--min-t1':
        options.filters.minT1 = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--max-t1':
        options.filters.maxT1 = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--min-t2':
        options.filters.minT2 = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--max-t2':
        options.filters.maxT2 = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--min-t4':
        options.filters.minT4 = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--max-t4':
        options.filters.maxT4 = parseNumberArg(arg, requireValue(arg, index));
        index += 1;
        break;
      case '--winners-only':
        options.filters.winnersOnly = true;
        break;
      case '--losers-only':
        options.filters.losersOnly = true;
        break;
      case '--complete-only':
        options.filters.completeOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.filters.winnersOnly && options.filters.losersOnly) {
    throw new Error('--winners-only and --losers-only cannot be combined');
  }

  return options;
}

function readExcludeSymbolsFromFile() {
  if (!fs.existsSync(EXCLUDE_FILE_PATH)) {
    return [];
  }

  return fs.readFileSync(EXCLUDE_FILE_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(normalizeSymbol)
    .filter(Boolean);
}

function getDisplayedLabels(labelArg) {
  if (labelArg === 'AB') return ['A', 'B'];
  return VALID_SECTION_LABELS.has(labelArg) ? [labelArg] : ['A', 'B'];
}

function buildFilterContext(options) {
  const fileExcludes = new Set(readExcludeSymbolsFromFile());
  const cliExcludes = new Set(options.filters.excludeSymbols);
  const includeSymbols = new Set(options.filters.includeSymbols);
  const excludeSymbols = new Set([...fileExcludes, ...cliExcludes]);

  includeSymbols.forEach((symbol) => excludeSymbols.delete(symbol));

  return {
    ...options.filters,
    excludeSymbols,
    includeSymbols,
    onlySymbols: new Set(options.filters.onlySymbols),
    catalystTypes: new Set(options.filters.catalystTypes),
    excludeFlags: new Set(options.filters.excludeFlags),
    displayLabels: new Set(getDisplayedLabels(options.label)),
    hasOutcomeFilters: [
      options.filters.minT1,
      options.filters.maxT1,
      options.filters.minT2,
      options.filters.maxT2,
      options.filters.minT4,
      options.filters.maxT4,
    ].some((value) => value != null)
      || options.filters.winnersOnly
      || options.filters.losersOnly
      || options.filters.completeOnly,
  };
}

function getNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rowHasFlag(row, normalizedFlag) {
  return normalizeArray(row.risk_flags).some((flag) => normalizeListToken(flag) === normalizedFlag);
}

function rowHasAnyFlag(row, normalizedFlags) {
  if (!normalizedFlags || normalizedFlags.size === 0) return false;
  return normalizeArray(row.risk_flags).some((flag) => normalizedFlags.has(normalizeListToken(flag)));
}

function rowMatchesCatalyst(row, catalystTypes) {
  if (!catalystTypes || catalystTypes.size === 0) return true;
  return catalystTypes.has(normalizeListToken(row.catalyst_type));
}

function applyFilters(row, filters) {
  const symbol = normalizeSymbol(row.symbol);
  const pickPrice = getNumeric(row.pick_price);
  const marketCap = getNumeric(row.market_cap);
  const premarketVolume = getNumeric(row.premarket_volume);
  const rvol = getNumeric(row.rvol);
  const gapPercent = getNumeric(row.gap_percent);
  const score = getNumeric(row.score);

  if (!filters.displayLabels.has(row.label)) return false;
  if (filters.onlySymbols.size > 0 && !filters.onlySymbols.has(symbol)) return false;
  if (filters.excludeSymbols.has(symbol) && !filters.includeSymbols.has(symbol)) return false;
  if (filters.minPrice != null && (pickPrice == null || pickPrice < filters.minPrice)) return false;
  if (filters.maxPrice != null && (pickPrice == null || pickPrice > filters.maxPrice)) return false;
  if (filters.minMarketCap != null && (marketCap == null || marketCap < filters.minMarketCap)) return false;
  if (filters.maxMarketCap != null && (marketCap == null || marketCap > filters.maxMarketCap)) return false;
  if (filters.minPremarketVolume != null && (premarketVolume == null || premarketVolume < filters.minPremarketVolume)) return false;
  if (filters.minRvol != null && (rvol == null || rvol < filters.minRvol)) return false;

  if (filters.minGap != null || filters.maxGap != null) {
    const absoluteGap = gapPercent == null ? null : Math.abs(gapPercent);
    if (filters.minGap != null && (absoluteGap == null || absoluteGap < filters.minGap)) return false;
    if (filters.maxGap != null && (absoluteGap == null || absoluteGap > filters.maxGap)) return false;
  }

  if (filters.direction === 'up' && (gapPercent == null || gapPercent <= 0)) return false;
  if (filters.direction === 'down' && (gapPercent == null || gapPercent >= 0)) return false;
  if (filters.minScore != null && (score == null || score < filters.minScore)) return false;
  if (filters.hasCatalyst && !(getNumeric(row.catalyst_score) > 0)) return false;
  if (!rowMatchesCatalyst(row, filters.catalystTypes)) return false;
  if (filters.excludeFlags.size > 0 && rowHasAnyFlag(row, filters.excludeFlags)) return false;
  if (filters.requireFlag && !rowHasFlag(row, filters.requireFlag)) return false;

  if (filters.completeOnly && row.outcome_status !== 'complete') return false;

  const t1 = getNumeric(row.outcome_t1_pct_change);
  const t2 = getNumeric(row.outcome_t2_pct_change);
  const t4 = getNumeric(row.outcome_t4_pct_change);

  if (filters.minT1 != null && (t1 == null || t1 < filters.minT1)) return false;
  if (filters.maxT1 != null && (t1 == null || t1 > filters.maxT1)) return false;
  if (filters.minT2 != null && (t2 == null || t2 < filters.minT2)) return false;
  if (filters.maxT2 != null && (t2 == null || t2 > filters.maxT2)) return false;
  if (filters.minT4 != null && (t4 == null || t4 < filters.minT4)) return false;
  if (filters.maxT4 != null && (t4 == null || t4 > filters.maxT4)) return false;
  if (filters.winnersOnly && !(t4 > 0)) return false;
  if (filters.losersOnly && !(t4 < 0)) return false;

  if (filters.hasOutcomeFilters) {
    const needsOutcome = filters.completeOnly
      || filters.minT1 != null
      || filters.maxT1 != null
      || filters.minT2 != null
      || filters.maxT2 != null
      || filters.minT4 != null
      || filters.maxT4 != null
      || filters.winnersOnly
      || filters.losersOnly;

    if (needsOutcome && [t1, t2, t4].every((value) => value == null) && row.outcome_status !== 'complete') {
      return false;
    }
  }

  return true;
}

async function queryLatestGeneration(sinceIso) {
  const result = await getQueryWithTimeout()(
    `SELECT MAX(generated_at) AS latest_generated_at
     FROM premarket_picks
     WHERE generated_at >= $1::timestamptz`,
    [sinceIso],
    { timeoutMs: 10000, label: 'view_picks.latest_generation', maxRetries: 0 }
  );
  return result.rows?.[0]?.latest_generated_at || null;
}

async function queryHeaderSummary(generatedAt) {
  if (!generatedAt) return [];
  const result = await getQueryWithTimeout()(
    `SELECT label, COUNT(*)::int AS count
     FROM premarket_picks
     WHERE generated_at = $1::timestamptz
     GROUP BY label
     ORDER BY label`,
    [generatedAt],
    { timeoutMs: 10000, label: 'view_picks.header_summary', maxRetries: 0 }
  );
  return result.rows || [];
}

async function queryGenerationRows(generatedAt) {
  if (!generatedAt) return [];
  const result = await getQueryWithTimeout()(
    `SELECT
       symbol,
       generated_at,
       label,
       score,
       structure_type,
       catalyst_type,
       catalyst_score,
       gap_percent,
       rvol,
       premarket_vwap,
       pick_price,
       above_vwap,
       market_cap,
       sector,
       sector_rank,
       premarket_volume,
       risk_flags,
       outcome_status,
       outcome_t1_pct_change,
       outcome_t2_pct_change,
       outcome_t4_pct_change
     FROM premarket_picks
     WHERE generated_at = $1::timestamptz
     ORDER BY label ASC, score DESC, symbol ASC`,
    [generatedAt],
    { timeoutMs: 15000, label: 'view_picks.generation_rows', maxRetries: 0 }
  );
  return result.rows || [];
}

async function queryOutcomeRows(sinceIso) {
  const result = await getQueryWithTimeout()(
    `SELECT
       symbol,
       generated_at,
       label,
       score,
       structure_type,
       catalyst_type,
       catalyst_score,
       gap_percent,
       rvol,
       premarket_vwap,
       pick_price,
       above_vwap,
       market_cap,
       sector,
       sector_rank,
       premarket_volume,
       risk_flags,
       outcome_status,
       outcome_t1_captured_at,
       outcome_t2_captured_at,
       outcome_t3_captured_at,
       outcome_t4_captured_at,
       outcome_t1_pct_change,
       outcome_t2_pct_change,
       outcome_t4_pct_change
     FROM premarket_picks
     WHERE generated_at >= $1::timestamptz
     ORDER BY generated_at DESC, label ASC, score DESC, symbol ASC`,
    [sinceIso],
    { timeoutMs: 15000, label: 'view_picks.outcome_rows', maxRetries: 0 }
  );
  return result.rows || [];
}

async function querySymbolDetail(symbol, sinceIso) {
  const result = await getQueryWithTimeout()(
    `SELECT *
     FROM premarket_picks
     WHERE symbol = $1
       AND ($2::timestamptz IS NULL OR generated_at >= $2::timestamptz)
     ORDER BY generated_at DESC
     LIMIT 1`,
    [symbol, sinceIso],
    { timeoutMs: 10000, label: 'view_picks.symbol_detail', maxRetries: 0 }
  );
  return result.rows?.[0] || null;
}

function buildHeaderSection(generatedAt, summaryRows) {
  const totalRows = summaryRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const labelDistribution = summaryRows.length === 0
    ? '(none)'
    : summaryRows.map((row) => `${row.label}:${row.count}`).join('  ');

  return {
    generated_at: generatedAt ? formatTimestamp(generatedAt) : '(none)',
    total_rows: totalRows || '(none)',
    label_distribution: labelDistribution,
  };
}

function buildLabelRows(rows, label, limit) {
  const matchingRows = rows.filter((row) => row.label === label);
  const cappedRows = Number.isFinite(limit) && limit > 0 ? matchingRows.slice(0, limit) : matchingRows;
  return cappedRows.map((row) => ({
    symbol: row.symbol,
    score: formatNumber(row.score, 1) || '-',
    structure_type: row.structure_type || '-',
    catalyst_type: row.catalyst_type || '-',
    gap_pct: formatSignedPercent(row.gap_percent),
    rvol: formatRvol(row.rvol),
    premarket_vwap: formatPrice(row.premarket_vwap),
    current_price: `${formatPrice(row.pick_price)} ${formatBooleanArrow(row.above_vwap)}`,
    market_cap: formatMarketCap(row.market_cap),
    sector: row.sector || '-',
    sector_rank: row.sector_rank == null ? '-' : String(row.sector_rank),
  }));
}

function buildRiskRows(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    normalizeArray(row.risk_flags).forEach((flag) => {
      counts.set(flag, (counts.get(flag) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([flagName, count]) => ({
      flag_name: flagName,
      count: String(count),
      percentage: rows.length > 0 ? `${((count / rows.length) * 100).toFixed(1)}%` : '0.0%',
    }));
}

function buildOutcomeRows(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const key = String(row.generated_at);
    const entry = grouped.get(key) || {
      generated_at: row.generated_at,
      total_picks: 0,
      t1_captured: 0,
      t2_captured: 0,
      t3_captured: 0,
      t4_captured: 0,
      complete: 0,
      partial: 0,
      errored: 0,
    };

    entry.total_picks += 1;
    if (row.outcome_t1_captured_at) entry.t1_captured += 1;
    if (row.outcome_t2_captured_at) entry.t2_captured += 1;
    if (row.outcome_t3_captured_at) entry.t3_captured += 1;
    if (row.outcome_t4_captured_at) entry.t4_captured += 1;
    if (row.outcome_status === 'complete') entry.complete += 1;
    if (row.outcome_status === 'partial') entry.partial += 1;
    if (row.outcome_status === 'errored') entry.errored += 1;
    grouped.set(key, entry);
  });

  return Array.from(grouped.values())
    .sort((left, right) => new Date(right.generated_at) - new Date(left.generated_at))
    .map((row) => ({
      generated_at: formatTimestamp(row.generated_at),
      total_picks: String(row.total_picks),
      t1_captured: String(row.t1_captured),
      t2_captured: String(row.t2_captured),
      t3_captured: String(row.t3_captured),
      t4_captured: String(row.t4_captured),
      complete: String(row.complete),
      partial: String(row.partial),
      errored: String(row.errored),
    }));
}

function buildDetailSections(row) {
  if (!row) return null;

  const riskFlags = normalizeArray(row.risk_flags);
  const why = normalizeArray(row.why);

  return {
    summary: [
      { field: 'symbol', value: row.symbol },
      { field: 'generated_at', value: formatTimestamp(row.generated_at) },
      { field: 'label', value: row.label || '-' },
      { field: 'score', value: formatNumber(row.score, 1) || '-' },
      { field: 'generator', value: row.generator || '-' },
      { field: 'trade_state', value: row.trade_state || '-' },
      { field: 'structure_type', value: row.structure_type || '-' },
      { field: 'catalyst_type', value: row.catalyst_type || '-' },
      { field: 'catalyst_source', value: row.catalyst_source || '-' },
      { field: 'catalyst_timestamp', value: formatTimestamp(row.catalyst_timestamp) },
      { field: 'catalyst_summary', value: row.catalyst_summary || '-' },
    ],
    scores: [
      { metric: 'score', value: formatNumber(row.score, 1) || '-' },
      { metric: 'catalyst_score', value: formatNumber(row.catalyst_score, 1) || '-' },
      { metric: 'gap_score', value: formatNumber(row.gap_score, 1) || '-' },
      { metric: 'volume_score', value: formatNumber(row.volume_score, 1) || '-' },
      { metric: 'structure_score', value: formatNumber(row.structure_score, 1) || '-' },
      { metric: 'regime_score', value: formatNumber(row.regime_score, 1) || '-' },
    ],
    metrics: [
      { metric: 'pick_price', value: formatPrice(row.pick_price) },
      { metric: 'previous_close', value: formatPrice(row.previous_close) },
      { metric: 'gap_percent', value: formatSignedPercent(row.gap_percent) },
      { metric: 'premarket_volume', value: row.premarket_volume == null ? '-' : String(row.premarket_volume) },
      { metric: 'premarket_volume_baseline', value: row.premarket_volume_baseline == null ? '-' : String(row.premarket_volume_baseline) },
      { metric: 'rvol', value: formatRvol(row.rvol) },
      { metric: 'premarket_high', value: formatPrice(row.premarket_high) },
      { metric: 'premarket_low', value: formatPrice(row.premarket_low) },
      { metric: 'premarket_vwap', value: formatPrice(row.premarket_vwap) },
      { metric: 'above_vwap', value: formatBooleanArrow(row.above_vwap) },
      { metric: 'near_high', value: row.near_high == null ? '-' : String(row.near_high) },
      { metric: 'market_cap', value: formatMarketCap(row.market_cap) },
      { metric: 'float_shares', value: row.float_shares == null ? '-' : String(row.float_shares) },
      { metric: 'sector', value: row.sector || '-' },
      { metric: 'sector_rank', value: row.sector_rank == null ? '-' : String(row.sector_rank) },
      { metric: 'market_regime', value: row.market_regime || '-' },
      { metric: 'vix_level', value: row.vix_level || '-' },
      { metric: 'stop_idea', value: formatPrice(row.stop_idea) },
      { metric: 'first_target', value: formatPrice(row.first_target) },
      { metric: 'invalidation', value: row.invalidation || '-' },
    ],
    outcomes: [
      { field: 'outcome_status', value: row.outcome_status || '-' },
      { field: 'outcome_complete', value: row.outcome_complete == null ? '-' : String(row.outcome_complete) },
      { field: 'outcome_t1_due_at', value: formatTimestamp(row.outcome_t1_due_at) },
      { field: 'outcome_t2_due_at', value: formatTimestamp(row.outcome_t2_due_at) },
      { field: 'outcome_t3_due_at', value: formatTimestamp(row.outcome_t3_due_at) },
      { field: 'outcome_t4_due_at', value: formatTimestamp(row.outcome_t4_due_at) },
      { field: 'outcome_t1_captured_at', value: formatTimestamp(row.outcome_t1_captured_at) },
      { field: 'outcome_t2_captured_at', value: formatTimestamp(row.outcome_t2_captured_at) },
      { field: 'outcome_t3_captured_at', value: formatTimestamp(row.outcome_t3_captured_at) },
      { field: 'outcome_t4_captured_at', value: formatTimestamp(row.outcome_t4_captured_at) },
      { field: 'outcome_t1_price', value: formatPrice(row.outcome_t1_price) },
      { field: 'outcome_t2_price', value: formatPrice(row.outcome_t2_price) },
      { field: 'outcome_t3_price', value: formatPrice(row.outcome_t3_price) },
      { field: 'outcome_t4_price', value: formatPrice(row.outcome_t4_price) },
      { field: 'outcome_t1_pct_change', value: formatSignedPercent(row.outcome_t1_pct_change) },
      { field: 'outcome_t2_pct_change', value: formatSignedPercent(row.outcome_t2_pct_change) },
      { field: 'outcome_t3_pct_change', value: formatSignedPercent(row.outcome_t3_pct_change) },
      { field: 'outcome_t4_pct_change', value: formatSignedPercent(row.outcome_t4_pct_change) },
      { field: 'outcome_last_attempted_at', value: formatTimestamp(row.outcome_last_attempted_at) },
    ],
    risk_flags: riskFlags,
    why,
    raw: row,
  };
}

function renderDetail(detail) {
  writeLine(`\nSYMBOL DETAIL: ${detail.raw.symbol}`);
  printSection('SUMMARY', [{ key: 'field', label: 'field' }, { key: 'value', label: 'value' }], detail.summary);
  printSection('SCORES', [{ key: 'metric', label: 'metric' }, { key: 'value', label: 'value' }], detail.scores);
  printSection('METRICS', [{ key: 'metric', label: 'metric' }, { key: 'value', label: 'value' }], detail.metrics);
  printSection('OUTCOMES', [{ key: 'field', label: 'field' }, { key: 'value', label: 'value' }], detail.outcomes);

  writeLine('\nRISK FLAGS');
  if (detail.risk_flags.length === 0) {
    writeLine('(none)');
  } else {
    detail.risk_flags.forEach((item) => writeLine(`- ${item}`));
  }

  writeLine('\nWHY');
  if (detail.why.length === 0) {
    writeLine('(none)');
  } else {
    detail.why.forEach((item) => writeLine(`- ${item}`));
  }
}

async function runDefaultView(options) {
  const filters = buildFilterContext(options);
  const generationSince = options.since || hoursAgoIso(DEFAULT_RECENT_HOURS);
  const outcomeSince = options.since || hoursAgoIso(DEFAULT_OUTCOME_HOURS);

  const latestGeneratedAt = await queryLatestGeneration(generationSince);
  const headerSummaryRows = await queryHeaderSummary(latestGeneratedAt);
  const generationRows = await queryGenerationRows(latestGeneratedAt);
  const outcomeRows = await queryOutcomeRows(outcomeSince);

  const filteredGenerationRows = generationRows.filter((row) => applyFilters(row, filters));
  const filteredOutcomeRows = outcomeRows.filter((row) => applyFilters(row, filters));
  const labelLimit = filters.limit != null ? Math.max(1, filters.limit) : null;

  const sections = {
    header: buildHeaderSection(latestGeneratedAt, headerSummaryRows),
    top_a_labels: buildLabelRows(filteredGenerationRows, 'A', labelLimit),
    top_b_labels: buildLabelRows(filteredGenerationRows, 'B', labelLimit ?? DEFAULT_B_LIMIT),
    top_c_labels: buildLabelRows(filteredGenerationRows, 'C', labelLimit),
    risk_flags: buildRiskRows(filteredGenerationRows),
    outcome_status: buildOutcomeRows(filteredOutcomeRows),
    meta: {
      generation_since: generationSince,
      outcome_since: outcomeSince,
      latest_generated_at: latestGeneratedAt,
      used_cli_table3: Boolean(CliTable),
      filters: {
        label: options.label,
        min_price: filters.minPrice,
        max_price: filters.maxPrice,
        min_market_cap: filters.minMarketCap,
        max_market_cap: filters.maxMarketCap,
        min_premarket_volume: filters.minPremarketVolume,
        min_rvol: filters.minRvol,
        min_gap: filters.minGap,
        max_gap: filters.maxGap,
        direction: filters.direction,
        min_score: filters.minScore,
        limit: filters.limit,
        exclude_symbols: Array.from(filters.excludeSymbols),
        include_symbols: Array.from(filters.includeSymbols),
        only_symbols: Array.from(filters.onlySymbols),
        catalyst_types: Array.from(filters.catalystTypes),
        has_catalyst: filters.hasCatalyst,
        exclude_flags: Array.from(filters.excludeFlags),
        require_flag: filters.requireFlag,
        winners_only: filters.winnersOnly,
        losers_only: filters.losersOnly,
        complete_only: filters.completeOnly,
      },
      counts: {
        latest_generation_total: generationRows.length,
        latest_generation_filtered: filteredGenerationRows.length,
        top_a_labels: filteredGenerationRows.filter((row) => row.label === 'A').length,
        top_b_labels: filteredGenerationRows.filter((row) => row.label === 'B').length,
        top_c_labels: filteredGenerationRows.filter((row) => row.label === 'C').length,
        outcome_rows: filteredOutcomeRows.length,
      },
      exclude_file_path: fs.existsSync(EXCLUDE_FILE_PATH) ? EXCLUDE_FILE_PATH : null,
    },
  };

  if (options.json) {
    writeLine(JSON.stringify(sections, null, 2));
    return;
  }

  printSection('HEADER', [
    { key: 'generated_at', label: 'generated_at' },
    { key: 'total_rows', label: 'total_rows' },
    { key: 'label_distribution', label: 'label_distribution' },
  ], [sections.header]);

  const sectionColumns = [
    { key: 'symbol', label: 'symbol' },
    { key: 'score', label: 'score' },
    { key: 'structure_type', label: 'structure_type' },
    { key: 'catalyst_type', label: 'catalyst_type' },
    { key: 'gap_pct', label: 'gap_pct' },
    { key: 'rvol', label: 'rvol' },
    { key: 'premarket_vwap', label: 'premarket_vwap' },
    { key: 'current_price', label: 'current_price' },
    { key: 'market_cap', label: 'market_cap' },
    { key: 'sector', label: 'sector' },
    { key: 'sector_rank', label: 'sector_rank' },
  ];

  const sectionLabels = getDisplayedLabels(options.label);
  sectionLabels.forEach((label) => {
    const key = `top_${label.toLowerCase()}_labels`;
    const hadBaseRows = generationRows.some((row) => row.label === label);
    const emptyMessage = hadBaseRows ? '(none — filtered)' : '(none)';
    printSection(`TOP ${label}-LABELS`, sectionColumns, sections[key], emptyMessage);
  });

  printSection('RISK FLAGS', [
    { key: 'flag_name', label: 'flag_name' },
    { key: 'count', label: 'count' },
    { key: 'percentage', label: 'percentage' },
  ], sections.risk_flags, generationRows.length > 0 ? '(none — filtered)' : '(none)');

  printSection('OUTCOME STATUS', [
    { key: 'generated_at', label: 'generated_at' },
    { key: 'total_picks', label: 'total_picks' },
    { key: 't1_captured', label: 't1_captured' },
    { key: 't2_captured', label: 't2_captured' },
    { key: 't3_captured', label: 't3_captured' },
    { key: 't4_captured', label: 't4_captured' },
    { key: 'complete', label: 'complete' },
    { key: 'partial', label: 'partial' },
    { key: 'errored', label: 'errored' },
  ], sections.outcome_status, outcomeRows.length > 0 ? '(none — filtered)' : '(none)');
}

async function runSymbolView(options) {
  const detailRow = await querySymbolDetail(options.symbol, options.since);
  const detail = buildDetailSections(detailRow);

  if (options.json) {
    writeLine(JSON.stringify(detail ? detail.raw : null, null, 2));
    return;
  }

  if (!detail) {
    writeLine(`\nSYMBOL DETAIL: ${options.symbol}`);
    writeLine('(none)');
    return;
  }

  renderDetail(detail);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    writeLine(HELP_TEXT.trimEnd());
    return;
  }

  if (options.symbol) {
    await runSymbolView(options);
    return;
  }

  await runDefaultView(options);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });