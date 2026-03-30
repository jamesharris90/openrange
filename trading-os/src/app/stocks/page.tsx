"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { toFixedSafe, percentSafe } from "@/lib/number";

type StockRow = {
  symbol?: string;
  price?: number | null;
  change_percent?: number | null;
  relative_volume?: number | null;
  market_cap?: number | null;
  sector?: string | null;
  why_moving?: string | string | null;
};

type StocksResponse = {
  data?: StockRow[];
  count?: number;
};

function toNum(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function mcapLabel(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return "—";
}

export default function StocksPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const stocksQuery = useQuery({
    queryKey: ["stocks", "list"],
    // screener has real prices; stocks-in-play has null price (no price column)
    queryFn: () => apiGet<StocksResponse>("/api/screener?limit=100&rvolMin=1&sortBy=relative_volume&sortDir=desc").catch(() => ({ data: [] })),
    ...QUERY_POLICY.medium,
  });

  const raw = stocksQuery.data;
  const rawRows = Array.isArray((raw as {rows?: StockRow[]})?.rows)
    ? (raw as {rows: StockRow[]}).rows
    : Array.isArray((raw as StocksResponse)?.data)
      ? (raw as StocksResponse).data!
      : [];
  const rows: StockRow[] = rawRows.filter(
    (r): r is StockRow => Boolean(r && r.symbol && Number.isFinite(Number(r.price)) && Number(r.price) > 0)
  );

  const filtered = search
    ? rows.filter((r) => String(r.symbol ?? "").toUpperCase().startsWith(search.toUpperCase()))
    : rows;

  const handleSymbol = (symbol: string) => {
    router.push(`/research/${encodeURIComponent(symbol)}`);
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by symbol..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-800 bg-[#121826] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                {["Symbol", "Price", "Change", "Rel. Vol", "Market Cap", "Sector", "Why Moving"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const cp = toNum(row.change_percent, NaN);
                const rvol = toNum(row.relative_volume, NaN);
                const mcap = toNum(row.market_cap, NaN);
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => handleSymbol(String(row.symbol))}
                    className="cursor-pointer border-b border-slate-800/50 transition hover:bg-slate-800/30"
                  >
                    <td className="px-4 py-3 font-semibold text-slate-100">{row.symbol}</td>
                    <td className="px-4 py-3 text-slate-300">
                      {Number.isFinite(toNum(row.price, NaN)) ? `$${toFixedSafe(row.price!, 2)}` : "—"}
                    </td>
                    <td className={`px-4 py-3 font-medium ${!Number.isFinite(cp) ? "text-slate-500" : cp > 0 ? "text-emerald-400" : cp < 0 ? "text-rose-400" : "text-slate-400"}`}>
                      {Number.isFinite(cp) ? (cp > 0 ? "+" : "") + percentSafe(cp, 2) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {Number.isFinite(rvol) ? `${toFixedSafe(rvol, 1)}x` : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {Number.isFinite(mcap) ? mcapLabel(mcap) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {row.sector ?? "—"}
                    </td>
                    <td className="px-4 py-3 max-w-xs text-slate-500 truncate">
                      {row.why_moving ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !stocksQuery.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-600">
                    No stocks found
                  </td>
                </tr>
              )}
              {stocksQuery.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-600">
                    Loading...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
