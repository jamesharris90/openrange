export type MarketQuoteNormalized = {
  symbol: string;
  price: number;
  change: number;
  volume: number;
  sector?: string;
  marketCap?: number;
  source?: string;
};

export type OpportunityNormalized = {
  symbol: string;
  strategy: string;
  probability: number;
  confidence: number;
  expectedMove: number;
};

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function resolveDataArray(payload: unknown): Array<Record<string, unknown>> {
  const root = toObject(payload);
  const direct = toArray(root.data);
  if (direct.length > 0) return direct;

  const dataObject = toObject(root.data);
  const nested = toArray(dataObject.data);
  if (nested.length > 0) return nested;

  return [];
}

export function normalizeMarketQuotes(payload: unknown): MarketQuoteNormalized[] {
  const rows = resolveDataArray(payload);

  return rows.flatMap((row) => {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const price = toFiniteNumber(row.price);
    const change = toFiniteNumber(row.change ?? row.change_percent ?? row.changePercent);
    const volume = toFiniteNumber(row.volume ?? row.volume_24h);
    const marketCap = toFiniteNumber(row.marketCap ?? row.market_cap);
    const sectorRaw = row.sector;
    const source = typeof row.source === "string" ? row.source : undefined;
    const sector = typeof sectorRaw === "string" ? sectorRaw : undefined;

    if (!symbol || price === null || change === null || volume === null) {
      console.error("[CONTRACT] invalid market quote row", { row });
      return [];
    }

    return [{ symbol, price, change, volume, sector, marketCap: marketCap ?? undefined, source }];
  });
}

export function normalizeOpportunities(payload: unknown): OpportunityNormalized[] {
  const rows = resolveDataArray(payload);

  return rows.flatMap((row) => {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const strategy = String(row.strategy || row.setup || row.setup_type || "").trim();
    const probability = toFiniteNumber(row.probability);
    const confidence = toFiniteNumber(row.confidence);
    const expectedMove = toFiniteNumber(row.expectedMove ?? row.expected_move);

    if (!symbol || !strategy || probability === null || confidence === null || expectedMove === null) {
      console.error("[CONTRACT] invalid opportunity row", { row });
      return [];
    }

    return [{ symbol, strategy, probability, confidence, expectedMove }];
  });
}

export function normalizeDashboardSummary(payload: unknown): {
  sectors: Array<Record<string, unknown>>;
  opportunities: OpportunityNormalized[];
  earnings: { today: Array<Record<string, unknown>>; week: Array<Record<string, unknown>> };
  news: Array<Record<string, unknown>>;
  topStrategies: Array<Record<string, unknown>>;
} {
  const root = toObject(payload);
  const data = toObject(root.data);
  const summary = toObject(data.summary);

  return {
    sectors: toArray(summary.sectors),
    opportunities: normalizeOpportunities({ data: summary.opportunities }),
    earnings: {
      today: toArray(toObject(summary.earnings).today),
      week: toArray(toObject(summary.earnings).week),
    },
    news: toArray(summary.news),
    topStrategies: toArray(summary.top_strategies),
  };
}
