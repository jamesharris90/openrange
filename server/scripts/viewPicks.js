/*
node server/scripts/viewPicks.js                  # default review
node server/scripts/viewPicks.js --label A        # only A-labels
node server/scripts/viewPicks.js --symbol BKNG    # detail view
node server/scripts/viewPicks.js --since "2026-05-04T13:30:00Z"
node server/scripts/viewPicks.js --json > picks.json
*/

const path = require('path');
const earlyJsonMode = process.argv.slice(2).includes('--json');

if (earlyJsonMode) {
  console.log = (...args) => process.stderr.write(`${args.join(' ')}\n`);
  console.warn = (...args) => process.stderr.write(`${args.join(' ')}\n`);
  console.info = (...args) => process.stderr.write(`${args.join(' ')}\n`);
}

require('../node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });

const { queryWithTimeout } = require('../db/pg');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const useColor = process.stdout.isTTY;
const DEFAULT_RECENT_HOURS = 2;
const DEFAULT_OUTCOME_HOURS = 24;
const VALID_LABELS = new Set(['A', 'B', 'C']);

let CliTable = null;
try {
  require.resolve('cli-table3');
  CliTable = require('cli-table3');
} catch (_error) {
  CliTable = null;
}

function parseArgs(argv) {
  const options = {
    json: false,
    since: null,
    label: null,
    symbol: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--since') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--since requires an ISO timestamp');
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid --since timestamp: ${value}`);
      }
      options.since = parsed.toISOString();
      index += 1;
      continue;
    }

    if (arg === '--label') {
      const value = String(argv[index + 1] || '').trim().toUpperCase();
      if (!VALID_LABELS.has(value)) {
        throw new Error('--label must be one of A, B, or C');
      }
      options.label = value;
      index += 1;
      continue;
    }

    if (arg === '--symbol') {
      const value = String(argv[index + 1] || '').trim().toUpperCase();
      if (!value) {
        throw new Error('--symbol requires a ticker');
      }
      options.symbol = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
}

function stripAnsi(value) {
  return String(value == null ? '' : value).replace(/\x1b\[[0-9;]*m/g, '');
}

function writeLine(value = '') {
  process.stdout.write(`${value}\n`);
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
  if (numeric > 0) return `${GREEN}${rendered}${RESET}`;
  return `${RED}${rendered}${RESET}`;
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

function printSection(title, columns, rows) {
  writeLine(`\n${title}`);
  if (!rows || rows.length === 0) {
    writeLine('(none)');
    return;
  }
  writeLine(getTableOutput(columns, rows));
}

async function queryLatestGeneration(sinceIso) {
  const result = await queryWithTimeout(
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
  const result = await queryWithTimeout(
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

async function queryLabelRows(generatedAt, labelFilter) {
  if (!generatedAt) return [];
  const result = await queryWithTimeout(
    `SELECT
       symbol,
       label,
       score,
       structure_type,
       catalyst_type,
       gap_percent,
       rvol,
       premarket_vwap,
       pick_price,
       above_vwap,
       market_cap,
       sector,
       sector_rank
     FROM premarket_picks
     WHERE generated_at = $1::timestamptz
       AND ($2::text IS NULL OR label = $2::text)
     ORDER BY label ASC, score DESC, symbol ASC`,
    [generatedAt, labelFilter],
    { timeoutMs: 15000, label: 'view_picks.label_rows', maxRetries: 0 }
  );
  return result.rows || [];
}

async function queryRiskFlags(generatedAt) {
  if (!generatedAt) return [];
  const result = await queryWithTimeout(
    `SELECT flag_name, COUNT(*)::int AS count
     FROM premarket_picks p
     CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p.risk_flags, '[]'::jsonb)) AS flag(flag_name)
     WHERE p.generated_at = $1::timestamptz
     GROUP BY flag_name
     ORDER BY count DESC, flag_name ASC`,
    [generatedAt],
    { timeoutMs: 15000, label: 'view_picks.risk_flags', maxRetries: 0 }
  );
  return result.rows || [];
}

async function queryOutcomeStatus(sinceIso) {
  const result = await queryWithTimeout(
    `SELECT
       generated_at,
       COUNT(*)::int AS total_picks,
       COUNT(*) FILTER (WHERE outcome_t1_captured_at IS NOT NULL)::int AS t1_captured,
       COUNT(*) FILTER (WHERE outcome_t2_captured_at IS NOT NULL)::int AS t2_captured,
       COUNT(*) FILTER (WHERE outcome_t3_captured_at IS NOT NULL)::int AS t3_captured,
       COUNT(*) FILTER (WHERE outcome_t4_captured_at IS NOT NULL)::int AS t4_captured,
       COUNT(*) FILTER (WHERE outcome_status = 'complete')::int AS complete,
       COUNT(*) FILTER (WHERE outcome_status = 'partial')::int AS partial,
       COUNT(*) FILTER (WHERE outcome_status = 'errored')::int AS errored
     FROM premarket_picks
     WHERE generated_at >= $1::timestamptz
     GROUP BY generated_at
     ORDER BY generated_at DESC`,
    [sinceIso],
    { timeoutMs: 15000, label: 'view_picks.outcome_status', maxRetries: 0 }
  );
  return result.rows || [];
}

async function querySymbolDetail(symbol, sinceIso) {
  const result = await queryWithTimeout(
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

function buildLabelRows(rows, label) {
  const filtered = rows.filter((row) => row.label === label);
  const capped = label === 'A' ? filtered : filtered.slice(0, 20);
  return capped.map((row) => ({
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

function buildRiskRows(rows, totalPicks) {
  return rows.map((row) => ({
    flag_name: row.flag_name,
    count: String(row.count),
    percentage: totalPicks > 0 ? `${((Number(row.count) / totalPicks) * 100).toFixed(1)}%` : '0.0%',
  }));
}

function buildOutcomeRows(rows) {
  return rows.map((row) => ({
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
  if (!row) {
    return null;
  }

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
  printSection('SUMMARY', [
    { key: 'field', label: 'field' },
    { key: 'value', label: 'value' },
  ], detail.summary);
  printSection('SCORES', [
    { key: 'metric', label: 'metric' },
    { key: 'value', label: 'value' },
  ], detail.scores);
  printSection('METRICS', [
    { key: 'metric', label: 'metric' },
    { key: 'value', label: 'value' },
  ], detail.metrics);
  printSection('OUTCOMES', [
    { key: 'field', label: 'field' },
    { key: 'value', label: 'value' },
  ], detail.outcomes);

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
  const generationSince = options.since || hoursAgoIso(DEFAULT_RECENT_HOURS);
  const outcomeSince = options.since || hoursAgoIso(DEFAULT_OUTCOME_HOURS);

  const latestGeneratedAt = await queryLatestGeneration(generationSince);
  const headerSummaryRows = await queryHeaderSummary(latestGeneratedAt);
  const labelRows = await queryLabelRows(latestGeneratedAt, options.label);
  const riskFlagRows = await queryRiskFlags(latestGeneratedAt);
  const outcomeStatusRows = await queryOutcomeStatus(outcomeSince);

  const header = buildHeaderSection(latestGeneratedAt, headerSummaryRows);
  const totalRows = headerSummaryRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const riskRows = buildRiskRows(riskFlagRows, totalRows);
  const outcomeRows = buildOutcomeRows(outcomeStatusRows);

  const sections = {
    header,
    top_a_labels: buildLabelRows(labelRows, 'A'),
    top_b_labels: buildLabelRows(labelRows, 'B'),
    top_c_labels: buildLabelRows(labelRows, 'C'),
    risk_flags: riskRows,
    outcome_status: outcomeRows,
    meta: {
      generation_since: generationSince,
      outcome_since: outcomeSince,
      latest_generated_at: latestGeneratedAt,
      used_cli_table3: Boolean(CliTable),
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
  ], [header]);

  if (options.label) {
    const key = `top_${options.label.toLowerCase()}_labels`;
    printSection(`TOP ${options.label}-LABELS`, [
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
    ], sections[key]);
  } else {
    printSection('TOP A-LABELS', [
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
    ], sections.top_a_labels);
    printSection('TOP B-LABELS', [
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
    ], sections.top_b_labels);
  }

  printSection('RISK FLAGS', [
    { key: 'flag_name', label: 'flag_name' },
    { key: 'count', label: 'count' },
    { key: 'percentage', label: 'percentage' },
  ], sections.risk_flags);

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
  ], sections.outcome_status);
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