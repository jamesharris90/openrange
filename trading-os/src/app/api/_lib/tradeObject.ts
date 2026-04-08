export type TradeExecutionPlan = {
  entry: string;
  stop: string;
  target: string;
};

export type TradeObject = {
  symbol: string;
  strategy: string;
  why_moving: string;
  how_to_trade: string;
  expected_move_percent: number;
  confidence: number;
  trade_confidence: number;
  change_percent: number;
  relative_volume: number;
  execution_plan: TradeExecutionPlan;
  trade_class: string;
  updated_at: string;
  source: string;
  raw: Record<string, unknown>;
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  if (value && typeof value === "object") return value as AnyRecord;
  return {};
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return "";
}

function sentimentMoveHint(value: unknown): number | null {
  const sentiment = String(value || "").trim().toLowerCase();
  if (!sentiment) return null;
  if (sentiment.includes("bull") || sentiment.includes("positive")) return 6;
  if (sentiment.includes("bear") || sentiment.includes("negative")) return 5;
  if (sentiment.includes("neutral")) return 3;
  return null;
}

function expectedMoveFrom(row: AnyRecord): number | null {
  const direct = toNumber(row.expected_move_percent ?? row.expected_move ?? row.expected_move_from_earnings);
  if (direct !== null) return direct;

  const low = toNumber(row.expected_move_low);
  const high = toNumber(row.expected_move_high);
  if (low !== null && high !== null) return Number(((low + high) / 2).toFixed(2));
  if (high !== null) return high;
  if (low !== null) return low;

  const strength = toNumber(row.strength_score ?? row.catalyst_strength);
  if (strength !== null) return Number((strength * 2).toFixed(2));

  const fromSentiment = sentimentMoveHint(row.sentiment);
  if (fromSentiment !== null) return fromSentiment;

  if (row.report_date || row.earnings_date) return 4;
  return null;
}

function confidenceFrom(row: AnyRecord): number {
  const raw = toNumber(row.trade_confidence ?? row.confidence ?? row.confidence_score ?? row.final_score ?? row.score);
  if (raw === null) {
    const sentiment = String(row.sentiment || "").trim().toLowerCase();
    if (sentiment.includes("bull") || sentiment.includes("positive")) return 68;
    if (sentiment.includes("bear") || sentiment.includes("negative")) return 64;
    if (sentiment.includes("neutral")) return 55;
    if (row.headline || row.trade_reason || row.why_moving) return 52;
    return 0;
  }
  if (raw <= 1) return Number((raw * 100).toFixed(2));
  return Number(Math.max(0, Math.min(100, raw)).toFixed(2));
}

function parseExecutionPlanText(value: unknown): TradeExecutionPlan | null {
  const text = String(value || "").trim();
  if (!text) return null;

  const normalized = text.replace(/\s+/g, " ");
  const parts = normalized.split(/\s+OR\s+/i).map((part) => part.trim()).filter(Boolean);
  const entry = parts[0] || normalized;
  const stop = parts[1] || "Below VWAP or session low";
  const target = "Scale at 1R/2R into momentum continuation";
  return { entry, stop, target };
}

function parseExecutionPlan(row: AnyRecord, strategy: string, expectedMove: number | null): TradeExecutionPlan | null {
  const existing = asRecord(row.execution_plan);
  const entry = firstNonEmpty(existing.entry, row.entry_price, row.entry);
  const stop = firstNonEmpty(existing.stop, row.stop_price, row.stop);
  const target = firstNonEmpty(existing.target, row.target_price, row.target);

  if (entry && stop && target) {
    return { entry, stop, target };
  }

  const fromText = parseExecutionPlanText(row.execution_plan);
  if (fromText) return fromText;

  const synthesizedEntry = firstNonEmpty(
    row.execution_summary,
    row.how_to_trade,
    `Confirm ${strategy} with volume before entry.`
  );
  const synthesizedStop = "Below VWAP or nearest invalidation level";
  const synthesizedTarget = expectedMove !== null
    ? `Target ${expectedMove}% move with partial scale-outs`
    : "Scale out at 1R and 2R targets";

  if (!synthesizedEntry) return null;

  return {
    entry: synthesizedEntry,
    stop: synthesizedStop,
    target: synthesizedTarget,
  };
}

function deriveStrategy(row: AnyRecord): string {
  return firstNonEmpty(
    row.strategy,
    row.setup,
    row.setup_type,
    row.catalyst_type,
    row.trade_class,
    "EVENT_DRIVEN"
  );
}

function deriveWhy(row: AnyRecord): string {
  return firstNonEmpty(
    row.why_moving,
    row.why,
    row.trade_reason,
    row.narrative,
    row.headline,
    row.catalyst_headline,
    row.reason,
    row.watch_reason,
    row.report_date ? `Earnings event scheduled for ${row.report_date}` : ""
  );
}

function deriveHow(row: AnyRecord, strategy: string): string {
  return firstNonEmpty(
    row.how_to_trade,
    row.how,
    row.execution_summary,
    row.execution_plan,
    row.execution,
    `Execute ${strategy} with defined risk and intraday confirmation.`
  );
}

function deriveUpdatedAt(row: AnyRecord): string {
  return firstNonEmpty(
    row.updated_at,
    row.created_at,
    row.event_time,
    row.published_at,
    row.report_date,
    new Date().toISOString()
  );
}

function deriveChangePercent(row: AnyRecord): number {
  return toNumber(row.change_percent ?? row.price_change_percent ?? row.percent_change) ?? 0;
}

function deriveRelativeVolume(row: AnyRecord): number {
  return toNumber(row.relative_volume ?? row.rvol ?? row.volume_ratio) ?? 0;
}

function deriveTradeClass(row: AnyRecord, source: string): string {
  const explicit = firstNonEmpty(row.trade_class);
  if (explicit) return explicit;
  if (source === "catalysts") return "WATCHLIST";
  if (source === "earnings") return "EVENT_DRIVEN";
  return "TRADEABLE";
}

export function extractRows(payload: unknown): AnyRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord);
  const root = asRecord(payload);
  const arrays = [root.data, root.items, root.results, root.rows];
  for (const candidate of arrays) {
    if (Array.isArray(candidate)) return candidate.map(asRecord);
  }
  return [];
}

export function buildTradeObject(row: AnyRecord, source: string): TradeObject | null {
  const symbol = toUpper(row.symbol);
  if (!symbol) return null;

  const strategy = deriveStrategy(row);
  const whyMoving = deriveWhy(row);
  const howToTrade = deriveHow(row, strategy);
  const expectedMove = expectedMoveFrom(row);
  const executionPlan = parseExecutionPlan(row, strategy, expectedMove);

  if (!strategy || !whyMoving || !howToTrade || expectedMove === null || !executionPlan) {
    return null;
  }

  const confidence = confidenceFrom(row);
  return {
    symbol,
    strategy,
    why_moving: whyMoving,
    how_to_trade: howToTrade,
    expected_move_percent: expectedMove,
    confidence,
    trade_confidence: confidence,
    change_percent: deriveChangePercent(row),
    relative_volume: deriveRelativeVolume(row),
    execution_plan: executionPlan,
    trade_class: deriveTradeClass(row, source),
    updated_at: deriveUpdatedAt(row),
    source,
    raw: row,
  };
}

export function normalizeTradeObjects(payload: unknown, source: string): {
  data: TradeObject[];
  rawCount: number;
  rejectedCount: number;
  lastUpdated: string;
} {
  const rows = extractRows(payload);
  const data = rows
    .map((row) => buildTradeObject(row, source))
    .filter((row): row is TradeObject => row !== null);

  const lastUpdated = data.reduce((latest, row) => {
    const rowTs = Date.parse(row.updated_at);
    const latestTs = Date.parse(latest);
    return Number.isFinite(rowTs) && rowTs > latestTs ? row.updated_at : latest;
  }, new Date(0).toISOString());

  return {
    data,
    rawCount: rows.length,
    rejectedCount: rows.length - data.length,
    lastUpdated,
  };
}

export function toStrictEnvelope(payload: unknown, source: string) {
  const normalized = normalizeTradeObjects(payload, source);
  return {
    success: true,
    data: normalized.data,
    count: normalized.data.length,
    last_updated: normalized.lastUpdated,
    source,
    rejected_count: normalized.rejectedCount,
    raw_count: normalized.rawCount,
  };
}