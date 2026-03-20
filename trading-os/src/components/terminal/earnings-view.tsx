"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { DataState } from "@/components/system/data-state";
import { fetchEarnings } from "@/lib/api/earnings";
import { normalizeDataSource } from "@/lib/data-source";
import { scoreEarnings } from "@/lib/earnings-score";
import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

function dateKeyToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(parsed);
}

function normalizeDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const short = raw.slice(0, 10);
  const parsed = new Date(`${short}T00:00:00`);
  if (!Number.isNaN(parsed.getTime())) return short;

  const fallback = new Date(raw);
  if (Number.isNaN(fallback.getTime())) return "";

  const year = fallback.getFullYear();
  const month = String(fallback.getMonth() + 1).padStart(2, "0");
  const day = String(fallback.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sessionTag(value: unknown): "AMC" | "BMO" | "" {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "AMC") return "AMC";
  if (raw === "BMO") return "BMO";
  return "";
}

type QuickFilter = "all" | "high-conviction" | "large-cap" | "high-iv";

type RadarRow = {
  symbol: string;
  source: "fmp" | "polygon" | "none";
  dateKey: string;
  session: "AMC" | "BMO" | "";
  marketCap: number;
  volume: number;
  price: number;
  prevClose: number;
  iv: number;
  expectedMove: number;
  expectedMovePercent: number;
  score: number;
  tradeability: string;
  whyTags: string[];
};

function tradeabilityLabel(expectedMovePct: number, volume: number, iv: number): string {
  const moveScore = Math.min(Math.max(expectedMovePct / 6, 0), 1);
  const volumeScore = Math.min(Math.max(volume / 5000000, 0), 1);
  const ivScore = Math.min(Math.max(iv / 0.4, 0), 1);
  const score = moveScore * 0.45 + volumeScore * 0.35 + ivScore * 0.2;

  if (score >= 0.67) return "🔥 High";
  if (score >= 0.4) return "⚠️ Medium";
  return "❌ Low";
}

export function EarningsView() {
  const today = dateKeyToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.earnings,
    queryFn: fetchEarnings,
    ...QUERY_POLICY.slow,
  });

  const displayData = useMemo<RadarRow[]>(() => {
    return data
      .map((row) => {
      const symbol = String(row.symbol || "").toUpperCase();
      const date = normalizeDate((row as unknown as { event_date?: unknown; date?: unknown }).event_date || (row as unknown as { event_date?: unknown; date?: unknown }).date);
      const session = sessionTag((row as unknown as { time?: unknown; session?: unknown }).time ?? (row as unknown as { time?: unknown; session?: unknown }).session);
      const source = normalizeDataSource((row as unknown as { source?: unknown }).source);

      if (!symbol || !date) {
        console.warn("[DATA QUALITY ISSUE]", {
          symbol,
          missing: [!symbol ? "symbol" : null, !date ? "date" : null].filter(Boolean),
        });
        return null;
      }

      const marketCap = toNumber((row as unknown as { market_cap?: unknown; marketCap?: unknown }).market_cap ?? (row as unknown as { market_cap?: unknown; marketCap?: unknown }).marketCap, 0);
      const volume = toNumber((row as unknown as { volume?: unknown; avgVolume?: unknown; averageVolume?: unknown }).volume ?? (row as unknown as { volume?: unknown; avgVolume?: unknown; averageVolume?: unknown }).avgVolume ?? (row as unknown as { volume?: unknown; avgVolume?: unknown; averageVolume?: unknown }).averageVolume, 0);
      const price =
        toNumber((row as unknown as { price?: unknown }).price, 0) ||
        toNumber((row as unknown as { prevClose?: unknown; prev_close?: unknown }).prevClose ?? (row as unknown as { prevClose?: unknown; prev_close?: unknown }).prev_close, 0);
      const prevClose = toNumber((row as unknown as { prevClose?: unknown; prev_close?: unknown }).prevClose ?? (row as unknown as { prevClose?: unknown; prev_close?: unknown }).prev_close, 0);
      const iv = toNumber((row as unknown as { iv?: unknown; implied_volatility?: unknown; impliedVolatility?: unknown }).iv ?? (row as unknown as { iv?: unknown; implied_volatility?: unknown; impliedVolatility?: unknown }).implied_volatility ?? (row as unknown as { iv?: unknown; implied_volatility?: unknown; impliedVolatility?: unknown }).impliedVolatility, 0);

      const feedExpectedMove = Math.abs(toNumber(row.expected_move, 0));
      const expectedMove = feedExpectedMove > 0 ? feedExpectedMove : price > 0 && iv > 0 ? price * iv : 0;
      const expectedMovePercent = price > 0 ? Number(((expectedMove / price) * 100).toFixed(2)) : 0;

      const score = scoreEarnings({
        expectedMove,
        volume,
        marketCap,
      });

      const whyTags: string[] = [];
      if (iv >= 0.35) whyTags.push("High IV expansion");
      if (marketCap >= 10_000_000_000) whyTags.push("Large cap mover");
      if (volume >= 1_000_000) whyTags.push("Low liquidity risk");

      return {
        symbol,
        source,
        dateKey: date || today,
        session,
        marketCap,
        volume,
        price,
        prevClose,
        iv,
        expectedMove,
        expectedMovePercent,
        score,
        tradeability: tradeabilityLabel(expectedMovePercent, volume, iv),
        whyTags,
      };
    })
      .filter((row): row is RadarRow => Boolean(row));
  }, [data, today]);

  const countsByDate = useMemo(() => {
    return displayData.reduce<Record<string, number>>((acc, row) => {
      const key = row.dateKey;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [displayData]);

  const weekDates = useMemo(() => {
    const uniqueDates = Array.from(new Set(displayData.map((row) => row.dateKey).filter(Boolean))).sort();
    return uniqueDates.slice(0, 7);
  }, [displayData]);

  const effectiveSelectedDate = weekDates.includes(selectedDate)
    ? selectedDate
    : (weekDates[0] || today);

  const byDate = useMemo(() => {
    return displayData.filter((entry) => entry.dateKey === effectiveSelectedDate);
  }, [displayData, effectiveSelectedDate]);

  const filtered = useMemo(() => {
    return byDate.filter((entry) => {
      if (quickFilter === "high-conviction") return entry.expectedMovePercent >= 4;
      if (quickFilter === "large-cap") return entry.marketCap >= 10_000_000_000;
      if (quickFilter === "high-iv") return entry.iv >= 0.35;
      return true;
    });
  }, [byDate, quickFilter]);

  const ranked = useMemo(() => {
    return filtered
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.marketCap !== a.marketCap) return b.marketCap - a.marketCap;
        if (b.expectedMovePercent !== a.expectedMovePercent) return b.expectedMovePercent - a.expectedMovePercent;
        return b.volume - a.volume;
      });
  }, [filtered]);

  const top = useMemo(() => ranked.slice(0, 5), [ranked]);

  return (
    <DataState loading={isLoading} error={error} data={displayData} emptyMessage="No data available">
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Earnings Calendar</div>
        <div className="earnings-date-bar flex gap-2 overflow-x-auto pb-1">
          {weekDates.map((date) => {
            const isActive = date === effectiveSelectedDate;
            const count = countsByDate[date] || 0;

            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`min-w-[130px] rounded-lg border px-3 py-2 text-left text-xs transition ${isActive ? "active border-emerald-500/70 bg-emerald-500/10 text-emerald-200" : "border-slate-800 text-slate-300 hover:bg-slate-900"}`}
              >
                <div className="font-medium">{formatDateLabel(date)}</div>
                <span className="mt-1 inline-block text-[11px] text-slate-400">{count} earnings</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {[
            { key: "all", label: "All" },
            { key: "high-conviction", label: "High Conviction" },
            { key: "large-cap", label: "Large Cap" },
            { key: "high-iv", label: "High IV" },
          ].map((item) => {
            const active = quickFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setQuickFilter(item.key as QuickFilter)}
                className={`rounded border px-3 py-1 ${active ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-200" : "border-slate-800 text-slate-300 hover:bg-slate-900"}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="top-opportunities grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {top.map((entry) => {
            const priorityClass = entry.score > 8
              ? "border-emerald-500/60 shadow-emerald-500/15"
              : entry.score > 5
                ? "border-amber-400/60"
                : "border-slate-800";

            return (
              <div key={entry.symbol} className={`rounded-xl border bg-slate-950/60 p-3 text-xs ${priorityClass}`}>
                <h3 className="font-mono text-sm text-slate-100">{entry.symbol}</h3>
                <p className="mt-1 text-slate-300">Expected Move: ±{toFixedSafe(entry.expectedMovePercent, 2)}%</p>
                <p className="text-slate-300">Score: {toFixedSafe(entry.score, 2)}</p>
                <p className="text-[11px] text-slate-500">Source: {entry.source}</p>
                <p className="text-slate-400">{entry.session === "AMC" ? "After Close" : entry.session === "BMO" ? "Before Open" : ""}</p>
                <Link href={`/research/${entry.symbol}`} className="mt-2 inline-block text-emerald-300 hover:text-emerald-200">
                  Trade Setup →
                </Link>
              </div>
            );
          })}
          {top.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-500 md:col-span-2 xl:col-span-5">
              No earnings for this date
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="uppercase tracking-wide text-slate-400">Selected Date</div>
          <div className="font-medium text-slate-200">{formatDateLabel(effectiveSelectedDate)}</div>
        </div>

        {ranked.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400">No earnings for this date</div>
        ) : (
          <div className="space-y-2">
            {ranked.map((row) => {
              const session = row.session;
              const sessionLabel = session === "AMC" ? "After Market Close" : session === "BMO" ? "Before Market Open" : "";
              const priorityClass = row.score > 8
                ? "border-l-4 border-l-emerald-500 shadow-emerald-500/20"
                : row.score > 5
                  ? "border-l-4 border-l-amber-400"
                  : "border-l-4 border-l-slate-700";

              return (
                <div
                  key={`${row.symbol}-${row.dateKey}-${row.session}`}
                  className={`grid rounded-lg border border-slate-800 p-3 text-xs text-slate-300 md:grid-cols-10 ${priorityClass}`}
                >
                  <span className="font-mono text-slate-100">{row.symbol}</span>
                  <span>{session}</span>
                  <span>{sessionLabel}</span>
                  <span>MCap {toFixedSafe(row.marketCap, 0)}</span>
                  <span>Move {percentSafe(row.expectedMovePercent, 2)}</span>
                  <span>Vol {toFixedSafe(row.volume, 0)}</span>
                  <span>IV {toFixedSafe(row.iv, 2)}</span>
                  <span>Score {toFixedSafe(row.score, 2)}</span>
                  <span>{row.tradeability}</span>
                  <Link
                    href={`/research/${row.symbol}`}
                    className="rounded border border-slate-700 px-2 py-1 text-center text-[11px] text-slate-100 hover:bg-slate-900"
                  >
                    View Trade Setup
                  </Link>
                  <span className="text-[11px] text-slate-500 md:col-span-10">Source: {row.source}</span>
                  <span className="md:col-span-10 text-[11px] text-slate-500">
                    {row.whyTags.length > 0 ? row.whyTags.join(" • ") : "Event-driven setup"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {ranked.length > 0 ? (
          <div className="mt-3 text-[11px] text-slate-500">
            Sorted by: Opportunity Score DESC, then Market Cap DESC, Expected Move DESC, Volume DESC
          </div>
        ) : null}

        <div className="mt-2 text-[11px] text-slate-500">
          Session tags: AMC = After Market Close, BMO = Before Market Open
        </div>
      </div>
    </div>
    </DataState>
  );
}
