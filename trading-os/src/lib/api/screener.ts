import { apiGet } from "@/lib/api/client";

export type ScreenerRow = {
  symbol: string;
  price: number;
  change_percent: number;
  volume: number;
  avg_volume_30d: number;
  relative_volume: number;
  market_cap: number;
  sector: string;
  instrument_type?: "STOCK" | "ETF" | "ADR" | "REIT" | "FUND" | "OTHER";
  catalyst_type: "NEWS" | "EARNINGS" | "UNUSUAL_VOLUME" | "UNKNOWN";
};

export type ScreenerResponse = {
  success: boolean;
  status?: string;
  message?: string;
  coverage?: number;
  required?: number;
  count?: number;
  page?: number;
  pageSize?: number;
  rows: ScreenerRow[];
};

export type ScreenerFilters = {
  page?: number;
  pageSize?: number;
  minPrice?: number;
  maxPrice?: number;
  minChange?: number;
  minRelVolume?: number;
  minMarketCap?: number;
  maxMarketCap?: number;
  sector?: string;
  sortBy?: "change" | "volume" | "relVolume" | "marketCap";
  mode?: "all" | "focus";
};

export async function getScreenerPayload(filters?: ScreenerFilters): Promise<ScreenerResponse> {
  const params = new URLSearchParams();
  params.set("page", String(filters?.page ?? 1));
  params.set("pageSize", String(filters?.pageSize ?? 25));
  params.set("mode", filters?.mode === "focus" ? "focus" : "all");

  const query = params.toString();
  const payload = await apiGet<
    Partial<ScreenerResponse> & { data?: ScreenerRow[]; rows?: ScreenerRow[] }
  >(
    `/api/screener${query ? `?${query}` : ""}`,
    { cache: "no-store" }
  );

  const rows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  return {
    success: Boolean(payload?.success),
    status: payload?.status,
    message: payload?.message,
    coverage: typeof payload?.coverage === "number" ? payload.coverage : undefined,
    required: typeof payload?.required === "number" ? payload.required : undefined,
    count: typeof payload?.count === "number" ? payload.count : rows.length,
    page: typeof payload?.page === "number" ? payload.page : 1,
    pageSize: typeof payload?.pageSize === "number" ? payload.pageSize : rows.length,
    rows,
  };
}

export async function getScreenerRows(filters?: ScreenerFilters): Promise<ScreenerRow[]> {
  const payload = await getScreenerPayload(filters);
  return Array.isArray(payload.rows) ? payload.rows : [];
}
