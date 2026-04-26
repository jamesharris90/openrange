"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Trade {
  id: number;
  chamber: string;
  transaction_date: string;
  disclosure_date: string;
  first_name: string | null;
  last_name: string;
  district: string | null;
  owner: string | null;
  asset_type: string | null;
  transaction_type: string;
  amount_range: string | null;
  amount_min: number | null;
  source_link: string | null;
  is_high_profile: boolean;
}

interface Stats {
  total_trades: number;
  purchases: number;
  sales: number;
  distinct_members: number;
  chambers: string[];
  high_profile_count: number;
}

interface CongressionalResponse {
  symbol: string;
  stats: Stats;
  trades: Trade[];
}

interface Props {
  symbol: string;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMember(trade: Trade) {
  return `${trade.first_name || ""} ${trade.last_name || ""}`.trim() || "Unknown";
}

function isPurchase(value: string | null | undefined) {
  return /^purchase/i.test(String(value || ""));
}

export default function CongressionalPanel({ symbol }: Props) {
  const [data, setData] = useState<CongressionalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/v2/congressional/by-symbol/${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return response.json();
      })
      .then((json: CongressionalResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "Unable to load congressional data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
        <div className="mb-4 text-xs uppercase tracking-[0.18em] text-slate-500">Congressional Activity</div>
        <div className="h-12 animate-pulse rounded bg-slate-800/30" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
        <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">Congressional Activity</div>
        <div className="text-sm text-slate-500">Unable to load congressional data</div>
      </section>
    );
  }

  if (!data || data.trades.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
        <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">Congressional Activity</div>
        <div className="text-sm text-slate-500">No disclosed congressional trades for {symbol}</div>
      </section>
    );
  }

  const { stats, trades } = data;
  const visibleTrades = trades.slice(0, 10);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Congressional Activity</div>
        <Link href={`/congress?symbol=${encodeURIComponent(symbol)}`} className="text-xs text-cyan-300 transition hover:text-cyan-200 hover:underline">
          View all on Congress page →
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Trades" value={stats.total_trades.toString()} />
        <Stat label="Members" value={stats.distinct_members.toString()} />
        <Stat label="Purchases / Sales" value={`${stats.purchases} / ${stats.sales}`} />
        <Stat label="Chambers" value={stats.chambers.join(", ").toUpperCase() || "—"} />
      </div>

      <div className="space-y-2">
        {visibleTrades.map((trade) => (
          <TradeRow key={trade.id} trade={trade} />
        ))}
      </div>

      {trades.length > visibleTrades.length ? (
        <div className="mt-4 text-center">
          <Link href={`/congress?symbol=${encodeURIComponent(symbol)}`} className="text-sm text-cyan-300 transition hover:text-cyan-200 hover:underline">
            View {trades.length - visibleTrades.length} more →
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-medium text-slate-200">{value}</div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const purchase = isPurchase(trade.transaction_type);
  const typeColor = purchase ? "text-emerald-300" : "text-rose-300";
  const memberName = formatMember(trade);

  return (
    <div className="flex flex-col gap-2 border-b border-slate-800/50 py-2 text-sm last:border-0 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className={trade.is_high_profile ? "font-medium text-amber-200" : "font-medium text-slate-200"}>{memberName}</span>
        {trade.is_high_profile ? (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-200">HIGH PROFILE</span>
        ) : null}
        <span className="text-xs uppercase text-slate-500">{trade.chamber}</span>
        {trade.district ? <span className="text-xs text-slate-500">{trade.district}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 md:justify-end">
        <span className={`${typeColor} font-medium`}>{trade.transaction_type}</span>
        <span>{trade.amount_range || "—"}</span>
        <span>{formatDate(trade.transaction_date)}</span>
        {trade.source_link ? (
          <a
            href={trade.source_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 transition hover:text-cyan-200"
            title="View original filing"
          >
            ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
