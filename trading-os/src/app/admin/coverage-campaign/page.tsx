"use client";

import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api/client";

type CoverageStatusRow = {
  status: string;
  count: number;
};

type CoverageProgress = {
  id: number;
  total_symbols: number;
  processed_symbols: number;
  has_data: number;
  unsupported: number;
  started_at: string;
  updated_at: string;
  progress_percent: number;
};

type CoverageCampaignResponse = {
  ok: boolean;
  generated_at: string;
  statuses: CoverageStatusRow[];
  counts: Record<string, number>;
  progress: CoverageProgress | null;
};

function formatNumber(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  return value.toLocaleString();
}

function formatTimestamp(value?: string | null) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

function statusCount(counts: Record<string, number> | undefined, key: string) {
  return Number(counts?.[key] || 0);
}

export default function CoverageCampaignPage() {
  const [data, setData] = useState<CoverageCampaignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await apiGet<CoverageCampaignResponse>("/api/admin/coverage-status");
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load coverage campaign status");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    const timer = window.setInterval(load, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const progress = data?.progress;
  const counts = data?.counts || {};
  const totalSymbols = Number(
    progress?.total_symbols
      || statusCount(counts, "HAS_DATA") + statusCount(counts, "UNSUPPORTED") + statusCount(counts, "MISSING")
  );
  const processedSymbols = Number(progress?.processed_symbols || 0);
  const progressPercent = Number(progress?.progress_percent || 0);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#16312a_0%,#091412_38%,#050807_100%)] px-6 py-10 text-stone-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 rounded-3xl border border-emerald-500/20 bg-black/30 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-300/70">Admin Coverage Campaign</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-50">Universe Coverage Monitor</h1>
          <p className="mt-3 max-w-2xl text-sm text-stone-300">
            Live classification state for the active screener universe. Only `HAS_DATA` symbols should flow into the screener.
          </p>
          <div className="mt-4 text-xs text-stone-400">Last refresh: {formatTimestamp(data?.generated_at)}</div>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-stone-400">Total Symbols</div>
            <div className="mt-3 text-3xl font-semibold text-stone-50">{formatNumber(totalSymbols)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-stone-400">Processed</div>
            <div className="mt-3 text-3xl font-semibold text-stone-50">{formatNumber(processedSymbols)}</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-emerald-200/70">HAS_DATA</div>
            <div className="mt-3 text-3xl font-semibold text-emerald-100">{formatNumber(statusCount(counts, "HAS_DATA"))}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-amber-200/70">UNSUPPORTED</div>
            <div className="mt-3 text-3xl font-semibold text-amber-100">{formatNumber(statusCount(counts, "UNSUPPORTED"))}</div>
          </div>
        </div>

        <section className="mt-6 rounded-3xl border border-white/10 bg-black/25 p-6 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-stone-400">Campaign Progress</div>
              <div className="mt-2 text-2xl font-semibold text-stone-50">{progressPercent.toFixed(2)}%</div>
            </div>
            <div className="text-right text-sm text-stone-300">
              <div>Started: {formatTimestamp(progress?.started_at)}</div>
              <div>Updated: {formatTimestamp(progress?.updated_at)}</div>
            </div>
          </div>
          <div className="mt-5 w-full rounded bg-gray-800">
            <div
              className="h-4 rounded bg-green-500 transition-all duration-500"
              style={{ width: `${Math.max(0, Math.min(progressPercent, 100))}%` }}
            />
          </div>
          <div className="mt-3 text-sm text-stone-400">
            {formatNumber(processedSymbols)} of {formatNumber(totalSymbols)} symbols classified
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs uppercase tracking-[0.24em] text-stone-400">Status Breakdown</div>
            <div className="mt-4 space-y-3">
              {(data?.statuses || []).map((row) => (
                <div key={row.status} className="flex items-center justify-between rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
                  <span className="text-sm text-stone-300">{row.status}</span>
                  <span className="text-lg font-semibold text-stone-50">{formatNumber(row.count)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs uppercase tracking-[0.24em] text-stone-400">Health Notes</div>
            <div className="mt-4 space-y-3 text-sm text-stone-300">
              <div className="rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
                Screener eligibility requires `HAS_DATA` only.
              </div>
              <div className="rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
                `MISSING` should remain at zero once the campaign is stable.
              </div>
              <div className="rounded-2xl border border-white/6 bg-black/20 px-4 py-3">
                `INACTIVE` rows are legacy records retained non-destructively.
              </div>
            </div>
          </div>
        </section>

        {loading ? <div className="mt-6 text-sm text-stone-400">Loading coverage campaign…</div> : null}
      </div>
    </main>
  );
}