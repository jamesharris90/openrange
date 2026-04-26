"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CongressionalFilters, CongressionalRecentResponse, CongressionalTrade } from "@/components/congress/types";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function formatMember(trade: CongressionalTrade) {
  const first = String(trade.first_name || "").trim();
  const last = String(trade.last_name || "").trim();
  return [first, last].filter(Boolean).join(" ") || "Unknown";
}

function formatChamber(value: string | null | undefined) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "senate") return "Senate";
  if (text === "house") return "House";
  return value || "—";
}

function formatTransactionType(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (/^purchase/i.test(text)) return "Purchase";
  if (/^sale/i.test(text)) return "Sale";
  return text || "—";
}

function isPurchase(value: string | null | undefined) {
  return /^purchase/i.test(String(value || ""));
}

function isSale(value: string | null | undefined) {
  return /^sale/i.test(String(value || ""));
}

function formatOwner(value: string | null | undefined) {
  const text = String(value || "").trim();
  return text || "—";
}

function getQueryParams(filters: CongressionalFilters, offset: number) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

  if (filters.chamber !== "all") params.set("chamber", filters.chamber);
  if (filters.transactionType !== "all") params.set("transaction_type", filters.transactionType);
  params.set("days", filters.days === "all" ? "365" : filters.days);
  if (filters.highProfileOnly) params.set("high_profile", "true");
  if (filters.symbol.trim()) params.set("symbol", filters.symbol.trim().toUpperCase());
  if (filters.member.trim()) params.set("member", filters.member.trim());

  return params;
}

function TableSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="grid grid-cols-8 gap-3 rounded-lg border border-slate-800/70 bg-slate-950/40 p-3">
          {Array.from({ length: 8 }).map((__, cellIndex) => (
            <div key={cellIndex} className="h-4 animate-pulse rounded bg-slate-800/70" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CongressionalTable({ filters }: { filters: CongressionalFilters }) {
  const [trades, setTrades] = useState<CongressionalTrade[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const fetchTrades = useCallback(
    async (nextOffset: number, append: boolean, signal?: AbortSignal) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const params = getQueryParams(filters, nextOffset);
        const response = await apiFetch(`/api/v2/congressional/recent?${params.toString()}`, {
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          throw new Error(`Congressional trades unavailable (${response.status})`);
        }

        const payload = (await response.json()) as CongressionalRecentResponse;
        setTotal(Number(payload.total || 0));
        setOffset(nextOffset);
        setTrades((current) => (append ? [...current, ...(payload.results || [])] : payload.results || []));
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load congressional trades.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    const controller = new AbortController();
    setTrades([]);
    setTotal(0);
    setOffset(0);
    void fetchTrades(0, false, controller.signal);
    return () => controller.abort();
  }, [fetchTrades, filterKey]);

  const shown = trades.length;
  const hasMore = shown < total;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50 shadow-sm shadow-black/20">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-100">Recent disclosures</div>
          <div className="text-xs text-slate-500">
            {loading ? "Loading trades…" : `${shown.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} results`}
          </div>
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => fetchTrades(0, false)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-500/15"
          >
            <RefreshCw className="size-3.5" /> Retry
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="p-6 text-sm text-red-200">{error}</div>
      ) : loading && !trades.length ? (
        <TableSkeleton />
      ) : trades.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-400">No trades match your filters.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/80 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Disclosure</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Member</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Chamber</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Symbol</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Owner</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {trades.map((trade) => (
                  <tr key={trade.id} className="transition hover:bg-slate-900/60">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">{formatDate(trade.disclosure_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-medium", trade.is_high_profile ? "text-amber-200" : "text-slate-100")}>
                          {formatMember(trade)}
                        </span>
                        {trade.district ? (
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                            {trade.district}
                          </span>
                        ) : null}
                        {trade.is_high_profile ? (
                          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                            Watch
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
                        {formatChamber(trade.chamber)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {trade.symbol ? (
                        <Link href={`/research-v2/${trade.symbol}`} className="font-semibold text-cyan-300 transition hover:text-cyan-200 hover:underline">
                          {trade.symbol}
                        </Link>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          isPurchase(trade.transaction_type) && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                          isSale(trade.transaction_type) && "border-red-400/30 bg-red-400/10 text-red-300",
                          !isPurchase(trade.transaction_type) && !isSale(trade.transaction_type) && "border-slate-700 bg-slate-900 text-slate-300"
                        )}
                      >
                        {formatTransactionType(trade.transaction_type)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">{trade.amount_range || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">{formatOwner(trade.owner)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {trade.source_link ? (
                        <a
                          href={trade.source_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-200"
                          aria-label={`Open filing for ${formatMember(trade)}`}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-center border-t border-slate-800 px-4 py-4">
            {hasMore ? (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => fetchTrades(offset + PAGE_SIZE, true)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-500/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Load 50 more"}
              </button>
            ) : (
              <div className="text-xs text-slate-500">End of results</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
