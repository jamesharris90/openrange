function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) <= 1) return n * 100;
  return n;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pickText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeExecutionPlan(raw, strategy, expectedMove) {
  const plan = raw && typeof raw.execution_plan === 'object' ? raw.execution_plan : null;
  const entry = pickText(plan?.entry, raw.entry, raw.entry_price, `Confirm ${strategy} with volume expansion`);
  const stop = pickText(plan?.stop, raw.stop, raw.stop_price, 'Below VWAP or invalidation low');
  const target = pickText(
    plan?.target,
    raw.target,
    raw.target_price,
    Number.isFinite(expectedMove) ? `Scale into ${expectedMove.toFixed(2)}% move` : 'Scale at 1R and 2R'
  );
  return { entry, stop, target };
}

function deriveConfidence(raw) {
  const explicit = toNum(raw.confidence ?? raw.trade_confidence ?? raw.confidence_score ?? raw.final_score ?? raw.score, NaN);
  if (Number.isFinite(explicit)) {
    return clamp(explicit <= 1 ? explicit * 100 : explicit, 1, 99);
  }

  const rvol = toNum(raw.relative_volume ?? raw.rvol, 0);
  const move = Math.abs(toNum(raw.expected_move_percent ?? raw.expected_move, 0));
  const catalystStrength = toNum(raw.strength_score ?? raw.catalyst_strength, 0);

  const heuristic = 40 + rvol * 8 + move * 1.7 + catalystStrength * 9;
  return clamp(heuristic, 20, 95);
}

function deriveExpectedMove(raw) {
  const direct = toPct(raw.expected_move_percent ?? raw.expected_move ?? raw.expected_move_low);
  if (Number.isFinite(direct)) return Math.abs(direct);

  const low = toPct(raw.expected_move_low);
  const high = toPct(raw.expected_move_high);
  if (Number.isFinite(low) && Number.isFinite(high)) return Math.abs((low + high) / 2);

  const atr = toNum(raw.atr, NaN);
  const price = toNum(raw.price, NaN);
  if (Number.isFinite(atr) && Number.isFinite(price) && price > 0) return Math.abs((atr / price) * 100);

  if (raw.report_date) return 3.5;
  return 2.2;
}

function deriveTradeClass(raw) {
  const explicit = cleanText(raw.trade_class).toUpperCase();
  if (explicit) return explicit;
  const score = toNum(raw.score ?? raw.final_score, 0);
  if (score >= 75) return 'TRADEABLE';
  if (score >= 50) return 'WATCHLIST';
  return 'UNTRADEABLE';
}

function buildFinalTradeObject(raw, source = 'unknown') {
  const symbol = cleanText(raw?.symbol).toUpperCase();
  if (!symbol) return null;

  const strategy = pickText(raw.strategy, raw.setup, raw.setup_type, raw.catalyst_type, 'EVENT_DRIVEN');
  const expectedMove = deriveExpectedMove(raw);
  const confidence = deriveConfidence(raw);
  const changePercent = toPct(raw.change_percent ?? raw.price_change_percent ?? raw.percent_change) || 0;
  const relativeVolume = toNum(raw.relative_volume ?? raw.rvol, 0);

  let whyMoving = pickText(
    raw.why_moving,
    raw.trade_reason,
    raw.headline,
    raw.narrative,
    raw.report_date ? `Earnings catalyst scheduled ${raw.report_date}` : ''
  );
  if (!whyMoving) {
    whyMoving = 'Technical breakout with volume';
  }

  let howToTrade = pickText(
    raw.how_to_trade,
    raw.execution_summary,
    raw.execution
  );
  if (!howToTrade) {
    howToTrade = 'Enter on breakout, stop below support, target next resistance';
  }

  const execution_plan = normalizeExecutionPlan(raw, strategy, expectedMove);
  const trade_class = deriveTradeClass(raw);

  const built = {
    symbol,
    strategy,
    why_moving: whyMoving,
    how_to_trade: howToTrade,
    confidence: Number(confidence.toFixed(2)),
    trade_confidence: Number(confidence.toFixed(2)),
    expected_move_percent: Number(expectedMove.toFixed(2)),
    change_percent: Number((changePercent || 0).toFixed(2)),
    relative_volume: Number(relativeVolume.toFixed(2)),
    execution_plan,
    trade_class,
    catalyst_type: cleanText(raw.catalyst_type || raw.event_type || raw.source_table || 'FLOW'),
    headline: pickText(raw.headline, raw.catalyst_headline, raw.why_moving),
    strength: Number(toNum(raw.strength_score ?? raw.catalyst_strength ?? raw.score, confidence / 100).toFixed(2)),
    updated_at: pickText(raw.updated_at, raw.created_at, raw.event_time, raw.timestamp, new Date().toISOString()),
    source: raw.source || 'fallback',
    raw,
  };

  built.tradeable =
    built.trade_class !== 'UNTRADEABLE' &&
    built.confidence >= 20 &&
    built.why_moving.length > 0 &&
    built.how_to_trade.length > 0;

  return built;
}

function buildFinalTradeObjects(rows, source = 'unknown') {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => buildFinalTradeObject(row, source))
    .filter((row) => row && row.tradeable);
}

module.exports = {
  buildFinalTradeObject,
  buildFinalTradeObjects,
};
