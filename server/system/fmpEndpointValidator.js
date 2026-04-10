require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { fmpRequest } = require('../lib/fmpClient');

const INPUTS = {
  stable_quote: { symbol: 'AAPL' },
  stable_quote_short: { symbol: 'AAPL' },
  stable_batch_quote: { symbols: 'AAPL,MSFT,NVDA,SPY,QQQ' },
  stable_batch_quote_short: { symbols: 'AAPL,MSFT,NVDA,SPY,QQQ' },
  stable_aftermarket_trade: { symbol: 'AAPL' },
  stable_aftermarket_quote: { symbol: 'AAPL' },
  stable_batch_aftermarket_trade: { symbols: 'AAPL,MSFT,NVDA' },
  stable_batch_aftermarket_quote: { symbols: 'AAPL,MSFT,NVDA' },
  stable_stock_price_change: { symbol: 'AAPL' },
  stable_batch_exchange_quote: { exchange: 'NASDAQ', short: 'true' },
  stable_stock_screener: { exchange: 'NASDAQ', limit: '100' },
  stable_market_gainers: {},
  stable_market_losers: {},
  stable_market_most_active: {},
  stable_stock_news: { symbols: 'AAPL', limit: '20' },
  stable_press_releases: { symbol: 'AAPL', limit: '20' },
  stable_earnings_calendar: (() => {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  })(),
  stable_historical_chart_1min: { symbol: 'AAPL' },
  stable_historical_price_eod: { symbol: 'AAPL' },
  v3_stock_screener: { limit: '50' },
  v3_market_gainers: {},
  v3_market_losers: {},
  v3_market_actives: {},
};
const V3_MOVER_KEYS = ['v3_market_gainers', 'v3_market_losers', 'v3_market_actives'];

function nowEasternParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(new Date()).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function isRegularMarketHoursET() {
  const { weekday, hour, minute } = nowEasternParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const totalMinutes = hour * 60 + minute;
  const start = 9 * 60 + 30;
  const end = 16 * 60;
  return totalMinutes >= start && totalMinutes <= end;
}

function enforceValidationRule(endpointKey, result, marketHours) {
  if (!result.success) return { status: 'error', reason: result.error || 'request_failed' };
  if (result.is_empty) return { status: 'empty', reason: 'empty_array' };

  if (endpointKey === 'v3_stock_screener') {
    if (result.count < 20) return { status: 'invalid_contract', reason: 'count_below_20' };
    return { status: 'valid', reason: null };
  }

  if (V3_MOVER_KEYS.includes(endpointKey)) {
    if (marketHours && result.count < 5) return { status: 'invalid_contract', reason: 'count_below_5_market_hours' };
    if (!marketHours && result.count === 0) return { status: 'empty', reason: 'zero_premarket' };
    return { status: 'valid', reason: null };
  }

  return { status: 'valid', reason: null };
}

async function main() {
  if (!process.env.FMP_API_KEY) throw new Error('FMP_API_KEY missing');
  const exists = await pool.query("select to_regclass('public.fmp_endpoint_registry') as reg");
  if (!exists.rows[0]?.reg) throw new Error('fmp_endpoint_registry missing in configured DB');

  const defs = await pool.query("select endpoint_key, endpoint_url, endpoint_family, purpose from public.fmp_endpoint_registry where is_active=true order by endpoint_key");
  const marketHours = isRegularMarketHoursET();
  const report = [];

  for (const def of defs.rows) {
    const input = INPUTS[def.endpoint_key];
    const invalid = !input;
    let result;
    if (invalid) {
      result = {
        success: false,
        endpoint_key: def.endpoint_key,
        http_status: 0,
        data: [],
        count: 0,
        error: 'missing_input_contract',
        is_empty: true,
      };
    } else {
      result = await fmpRequest({
        endpointKey: def.endpoint_key,
        endpointUrl: def.endpoint_url,
        query: input,
        timeoutMs: 3000,
        retryAttempts: 1,
      });
    }
    const validation = enforceValidationRule(def.endpoint_key, result, marketHours);
    const status = invalid ? 'invalid_contract' : validation.status;
    const contract = {
      endpoint_key: def.endpoint_key,
      endpoint_family: def.endpoint_family,
      purpose: def.purpose,
      http_status: result.http_status,
      duration_ms: result.duration_ms || null,
      timed_out: String(result.error || '').toLowerCase().includes('timeout'),
      query_used: input || {},
      payload_shape: {
        top_type: 'array',
        top_keys: [],
        rows_detected: result.count,
        sample_fields: result.data[0] && typeof result.data[0] === 'object' ? Object.keys(result.data[0]).slice(0, 20) : [],
      },
      validation_rule: validation.reason,
      market_hours_et: marketHours,
    };

    await pool.query(
      "update public.fmp_endpoint_registry set validation_status=$2,last_validated_at=now(),last_http_status=$3,last_error=$4,response_contract=$5::jsonb,updated_at=now() where endpoint_key=$1",
      [def.endpoint_key, status, result.http_status || null, result.error || (status === 'valid' ? null : validation.reason || status), JSON.stringify(contract)]
    );

    report.push({
      endpoint_key: def.endpoint_key,
      status,
      http_status: result.http_status,
      duration_ms: result.duration_ms || null,
      timed_out: String(result.error || '').toLowerCase().includes('timeout'),
      rows_detected: result.count,
      error: result.error || null,
      is_empty: result.is_empty,
    });
  }

  const v3ScreenerValid = report.some((r) => r.endpoint_key === 'v3_stock_screener' && r.status === 'valid');
  const v3MoverValid = report.some((r) => V3_MOVER_KEYS.includes(r.endpoint_key) && r.status === 'valid');

  const summary = {
    generated_at: new Date().toISOString(),
    total: report.length,
    by_status: report.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {}),
    market_hours_et: marketHours,
    v3_requirements: {
      v3_stock_screener_valid: v3ScreenerValid,
      v3_any_mover_valid: v3MoverValid,
      v3_movers_valid: report.filter((r) => V3_MOVER_KEYS.includes(r.endpoint_key) && r.status === 'valid').map((r) => r.endpoint_key),
    },
  };

  const logsDir = path.resolve(__dirname, '..', '..', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'fmp_endpoint_validation_report.json'), JSON.stringify({ generated_at: summary.generated_at, report }, null, 2));
  fs.writeFileSync(path.join(logsDir, 'fmp_endpoint_validation_summary.json'), JSON.stringify(summary, null, 2));

  await pool.end();

  if (!v3ScreenerValid || !v3MoverValid) {
    console.error('V3 ENDPOINTS FAILED — DO NOT PROCEED');
    process.exit(1);
  }
  console.log('V3 ENDPOINTS VERIFIED — SAFE TO PROCEED TO PHASE 3');
}

main().catch((err) => {
  const logsDir = path.resolve(__dirname, '..', '..', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'fmp_endpoint_validation_summary.json'), JSON.stringify({ generated_at: new Date().toISOString(), fatal_error: err.message }, null, 2));
  console.error(err.message);
  process.exit(1);
});
