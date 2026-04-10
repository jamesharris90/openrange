const BASE = 'http://localhost:3001';

function toNum(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function toUtcMidnight(dateInput) {
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function getWeekRange(date) {
  const today = toUtcMidnight(date);
  const day = today.getUTCDay();
  let monday;

  if (day === 6) monday = addUtcDays(today, 2);
  else if (day === 0) monday = addUtcDays(today, 1);
  else monday = addUtcDays(today, -(day - 1));

  const friday = addUtcDays(monday, 4);
  return { today, monday, friday };
}

function toRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function firstJson(paths) {
  for (const p of paths) {
    try {
      const payload = await getJson(p);
      return { path: p, payload };
    } catch {
      // continue
    }
  }
  return { path: null, payload: [] };
}

function parseEarningsDate(row) {
  const raw = row?.report_date || row?.date || row?.earnings_date;
  if (!raw) return null;
  return toUtcMidnight(`${String(raw).slice(0, 10)}T00:00:00Z`);
}

async function main() {
  const rawCalendar = toRows(await getJson('/api/earnings/calendar'));
  const dates = rawCalendar
    .map((r) => String(r.report_date || r.date || r.earnings_date || '').slice(0, 10))
    .filter(Boolean)
    .sort();

  console.log('STEP1 total rows returned:', rawCalendar.length);
  console.log('STEP1 min report_date:', dates[0] || 'none');
  console.log('STEP1 max report_date:', dates[dates.length - 1] || 'none');
  console.log('STEP1 sample 5 rows:', JSON.stringify(rawCalendar.slice(0, 5), null, 2));

  const week = getWeekRange(new Date());
  const weekStart = isoDate(week.monday);
  const weekEnd = isoDate(week.friday);
  const isWeekend = [0, 6].includes(week.today.getUTCDay());

  const requested = toRows(await getJson(`/api/earnings/calendar?from=${weekStart}&to=${weekEnd}&limit=400`));
  let filtered = requested
    .map((row) => {
      const date = parseEarningsDate(row);
      if (!date) return null;
      const key = isoDate(date);
      if (key < weekStart || key > weekEnd) return null;
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      if (!symbol) return null;
      return { ...row, symbol, day_key: key };
    })
    .filter(Boolean);

  console.log('STEP2 computed today:', isoDate(week.today));
  console.log('STEP2 computed week start/end:', weekStart, weekEnd);
  console.log('STEP2 filtered earnings count:', filtered.length);

  if (filtered.length === 0) {
    console.log('EARNINGS FILTER RETURNED ZERO - CHECK DATE LOGIC');
    filtered = rawCalendar
      .map((row) => {
        const date = parseEarningsDate(row);
        if (!date) return null;
        const symbol = String(row?.symbol || '').trim().toUpperCase();
        if (!symbol) return null;
        return { ...row, symbol, day_key: isoDate(date) };
      })
      .filter(Boolean);
  }

  const symbols = [...new Set(filtered.map((r) => r.symbol))];
  const calendarBySymbol = Object.fromEntries(filtered.map((row) => [row.symbol, row]));

  const quotesPayload = await firstJson([
    `/api/market_quotes?symbols=${encodeURIComponent(symbols.join(','))}`,
    `/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`,
  ]);
  const metricsPayload = await firstJson(['/api/market_metrics', '/api/market-metrics', '/api/metrics']);
  const topPayload = await firstJson(['/api/intelligence/top-opportunities?limit=300', '/api/intelligence/top-opportunities']);

  const quotesMap = Object.fromEntries(toRows(quotesPayload.payload).map((r) => [String(r?.symbol || '').toUpperCase(), r]));
  const metricsMap = Object.fromEntries(toRows(metricsPayload.payload).map((r) => [String(r?.symbol || '').toUpperCase(), r]));
  const topMap = Object.fromEntries(toRows(topPayload.payload).map((r) => [String(r?.symbol || '').toUpperCase(), r]));

  for (const symbol of symbols.slice(0, 5)) {
    const quote = quotesMap[symbol] || null;
    const metric = metricsMap[symbol] || null;
    const top = topMap[symbol] || null;
    const calendarRow = calendarBySymbol[symbol] || null;
    const newsRows = toRows((await firstJson([`/api/news?symbol=${encodeURIComponent(symbol)}`])).payload);

    const price = toNum(quote?.price ?? metric?.price, null);
    const atr = toNum(metric?.atr, null);
    const atrPct = atr != null && price != null && price > 0 ? (atr / price) * 100 : null;
    const emRaw = toNum(
      calendarRow?.expected_move_percent
      ?? calendarRow?.expectedMovePercent
      ?? top?.expected_move_percent
      ?? top?.expectedMovePercent
      ?? top?.expected_move
      ?? metric?.expected_move_percent,
      null,
    );
    const expectedMove = emRaw != null ? emRaw : (atrPct != null ? atrPct * 0.9 : null);

    const missing = [];
    if (!quote) missing.push('quote');
    if (!metric) missing.push('metrics');
    if (newsRows.length === 0) missing.push('news');
    if (expectedMove == null || expectedMove <= 0) missing.push('expected_move');

    console.log(`STEP3 ${symbol}:`);
    console.log('  quote found?', !!quote);
    console.log('  metrics found?', !!metric);
    console.log('  news count?', newsRows.length);
    console.log('  expected move derived?', expectedMove);
    if (missing.length) console.log('  missing fields:', missing.join(', '));
  }

  const enriched = filtered
    .map((row) => {
      const symbol = row.symbol;
      const quote = quotesMap[symbol] || {};
      const metric = metricsMap[symbol] || {};
      const top = topMap[symbol] || {};

      const price = toNum(quote?.price ?? metric?.price, null);
      const atr = toNum(metric?.atr, null);
      const atrPct = atr != null && price != null && price > 0 ? (atr / price) * 100 : null;

      const expectedRaw = toNum(top?.expected_move_percent ?? top?.expectedMovePercent ?? top?.expected_move ?? metric?.expected_move_percent, null);
      const expectedRawWithCalendar = toNum(
        row?.expected_move_percent
        ?? row?.expectedMovePercent
        ?? expectedRaw,
        null,
      );
      const expectedMove = expectedRawWithCalendar != null ? expectedRawWithCalendar : (atrPct != null ? atrPct * 0.9 : null);

      const marketCapRaw = toNum(metric?.market_cap ?? quote?.market_cap ?? top?.market_cap, null);
      const volumeRaw = toNum(metric?.volume ?? quote?.volume ?? top?.volume, null);
      const rvol = toNum(metric?.relative_volume ?? metric?.rvol ?? quote?.relative_volume, null);

      return {
        symbol,
        expected_move_percent: expectedMove != null && expectedMove > 0 ? expectedMove : null,
        market_cap: marketCapRaw != null && marketCapRaw > 0 ? marketCapRaw : null,
        volume: volumeRaw != null && volumeRaw > 0 ? volumeRaw : null,
        rvol,
      };
    })
    .sort((a, b) => toNum(b.expected_move_percent, -1) - toNum(a.expected_move_percent, -1));

  const displayed = enriched;
  if (displayed.length < 10) {
    console.log('INSUFFICIENT EARNINGS DISPLAYED');
  }

  const zeroSummary = {
    market_cap_zero_or_missing: displayed.filter((r) => r.market_cap == null).length,
    volume_zero_or_missing: displayed.filter((r) => r.volume == null).length,
    expected_move_zero_or_missing: displayed.filter((r) => r.expected_move_percent == null).length,
  };

  console.log('STEP4 zero-value handling summary:', zeroSummary);
  console.log('STEP5 rendered count:', displayed.length);
  console.log(
    'STEP5 sorted top expected move symbols:',
    displayed
      .slice(0, 10)
      .map((r) => `${r.symbol}:${toNum(r.expected_move_percent, 0).toFixed(2)}`)
      .join(', '),
  );

  const final = {
    total_earnings_displayed: displayed.length,
    unique_symbols_count: new Set(displayed.map((r) => r.symbol)).size,
    number_with_expected_move_gt_0: displayed.filter((r) => toNum(r.expected_move_percent, 0) > 0).length,
    number_with_rvol_gt_1_5: displayed.filter((r) => toNum(r.rvol, 0) > 1.5).length,
    weekend_mode_expected_next_week: isWeekend,
  };

  console.log('STEP6 final state:', final);
}

main().catch((err) => {
  console.error('VERIFY FAILED', err.message);
  process.exit(1);
});
