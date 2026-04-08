"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api/client";

type CampaignStatus = {
  generated_at?: string;
  cycle?: number;
  phase?: string;
  completed?: boolean;
  in_progress?: boolean;
  missing_news_count?: number;
  missing_earnings_count?: number;
  recent_ipo_exemptions?: number;
  attempted_news_symbols?: number;
  resolved_news_symbols?: number;
  unresolved_news_symbols?: number;
  retry_attempted_news?: boolean;
  news_batch_size?: number;
  no_progress_cycles?: number;
  news_progress?: number;
  earnings_progress?: number;
  postcheck?: {
    missing_news_count?: number;
    missing_earnings_count?: number;
    news_progress?: number;
    earnings_progress?: number;
    recent_ipo_exemptions?: number;
  };
};

type CampaignBatch = {
  batch_index?: number;
  symbols?: string[];
  resolved_symbols?: string[];
  unresolved_symbols?: string[];
  total_inserted_primary?: number;
  started_at?: string;
  completed_at?: string;
};

type CampaignCheckpoint = {
  updated_at?: string;
  supervisor?: {
    cycles_completed?: number;
    no_progress_cycles?: number;
    last_hourly_report_at?: string | null;
    retry_attempted_news?: boolean;
    effective_news_batch_size?: number;
  };
  news?: {
    attempted_symbols?: string[];
    resolved_symbols?: string[];
    unresolved_symbols?: string[];
    batches?: CampaignBatch[];
    completed?: boolean;
  };
  earnings?: {
    completed?: boolean;
    summary?: {
      symbols_requested?: number;
      history_ingested?: number;
      symbols_with_full_history?: number;
      symbols_with_partial_history?: number;
      symbols_with_no_history?: number;
      failed_symbols?: string[];
      duration_ms?: number;
    } | null;
  };
};

type CampaignResponse = {
  success: boolean;
  generatedAt: string;
  status: CampaignStatus | null;
  checkpoint: CampaignCheckpoint | null;
  summary?: {
    baseline?: {
      missingNewsCount?: number | null;
      missingEarningsCount?: number | null;
      generatedAt?: string | null;
    };
    current?: {
      missingNewsCount?: number | null;
      missingEarningsCount?: number | null;
      generatedAt?: string | null;
    };
    completion?: {
      newsPercent?: number | null;
      earningsPercent?: number | null;
    };
  };
  hourly: Array<Record<string, unknown>>;
  stdoutTail: string[];
  files: Record<string, { exists: boolean; updatedAt: string | null; sizeBytes: number }>;
};

type BackfillJobResponse = {
  success: boolean;
  generatedAt: string;
  status: {
    status?: string;
    pid?: number;
    pidAlive?: boolean;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    checkpointFile?: string | null;
    result?: {
      symbolsProcessed?: number;
      totalSymbols?: number;
      generatedSignals?: number;
      peakMemoryMb?: number;
      resumedFromCheckpoint?: boolean;
    };
  } | null;
  checkpoint: {
    processedSymbols?: number;
    totalSymbols?: number;
    persistedSignals?: number;
    peakMemoryMb?: number;
    lastCompletedSymbol?: string;
    updatedAt?: string;
    status?: string;
  } | null;
  summary: {
    processedSymbols?: number | null;
    totalSymbols?: number | null;
    persistedSignals?: number | null;
    peakMemoryMb?: number | null;
    progressPercent?: number | null;
    lastCompletedSymbol?: string | null;
    resumedFromCheckpoint?: boolean;
  };
  stdoutTail: string[];
  files: Record<string, { exists: boolean; updatedAt: string | null; sizeBytes: number }>;
};

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

function formatNumber(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toLocaleString();
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function isFreshTimestamp(value?: string | null, maxAgeMs = 45000) {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= maxAgeMs;
}

function useCountdown(seconds: number) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const timer = window.setInterval(() => {
      setRemaining((current) => (current <= 1 ? seconds : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  return remaining;
}

export default function CoverageCampaignPage() {
  const [data, setData] = useState<CampaignResponse | null>(null);
  const [backfillJob, setBackfillJob] = useState<BackfillJobResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshEverySeconds = 5;
  const countdown = useCountdown(refreshEverySeconds);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [next, nextBackfill] = await Promise.all([
          apiGet<CampaignResponse>("/api/system/coverage-campaign"),
          apiGet<BackfillJobResponse>("/api/system/phase2-backfill"),
        ]);
        if (!cancelled) {
          setData(next);
          setBackfillJob(nextBackfill);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load campaign monitor");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    const timer = window.setInterval(() => {
      setRefreshTick((current) => current + 1);
    }, refreshEverySeconds * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (refreshTick === 0) return;

    let cancelled = false;
    async function load() {
      try {
        const [next, nextBackfill] = await Promise.all([
          apiGet<CampaignResponse>("/api/system/coverage-campaign"),
          apiGet<BackfillJobResponse>("/api/system/phase2-backfill"),
        ]);
        if (!cancelled) {
          setData(next);
          setBackfillJob(nextBackfill);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to refresh campaign monitor");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const status = data?.status;
  const checkpoint = data?.checkpoint;
  const summary = data?.summary;
  const hourly = data?.hourly || [];
  const backfillSummary = backfillJob?.summary;
  const backfillStatus = backfillJob?.status;
  const backfillCheckpoint = backfillJob?.checkpoint;
  const backfillLive = backfillStatus?.status === "running" && backfillStatus?.pidAlive === true;

  const derived = useMemo(() => {
    const missingNews = typeof status?.postcheck?.missing_news_count === "number"
      ? status.postcheck.missing_news_count
      : typeof status?.missing_news_count === "number"
        ? status.missing_news_count
        : null;
    const missingEarnings = typeof status?.postcheck?.missing_earnings_count === "number"
      ? status.postcheck.missing_earnings_count
      : typeof status?.missing_earnings_count === "number"
        ? status.missing_earnings_count
        : null;
    const recentIpos = typeof status?.postcheck?.recent_ipo_exemptions === "number"
      ? status.postcheck.recent_ipo_exemptions
      : typeof status?.recent_ipo_exemptions === "number"
        ? status.recent_ipo_exemptions
        : null;
    const newsResolved = checkpoint?.news?.resolved_symbols?.length ?? status?.resolved_news_symbols ?? 0;
    const newsAttempted = checkpoint?.news?.attempted_symbols?.length ?? status?.attempted_news_symbols ?? 0;
    const unresolved = checkpoint?.news?.unresolved_symbols?.length ?? status?.unresolved_news_symbols ?? 0;
    const targetUniverse = missingNews !== null ? missingNews + newsResolved : null;
    const completionPct = targetUniverse && targetUniverse > 0 ? (newsResolved / targetUniverse) * 100 : null;
    const batches = checkpoint?.news?.batches || [];
    const latestBatch = batches[batches.length - 1] || null;
    const latestSymbols = latestBatch?.resolved_symbols?.length ? latestBatch.resolved_symbols : latestBatch?.symbols || [];
    const heartbeatAt = checkpoint?.updated_at || status?.generated_at || data?.generatedAt || null;
    const liveNow = isFreshTimestamp(heartbeatAt);
    const livePhase = status?.phase ? String(status.phase).replace(/_/g, " ") : checkpoint?.earnings?.completed ? "completed" : checkpoint?.news?.completed ? "earnings" : "news";

    return {
      missingNews,
      missingEarnings,
      baselineNews: summary?.baseline?.missingNewsCount ?? null,
      baselineEarnings: summary?.baseline?.missingEarningsCount ?? null,
      currentNews: summary?.current?.missingNewsCount ?? missingNews,
      currentEarnings: summary?.current?.missingEarningsCount ?? missingEarnings,
      newsReductionPct: typeof summary?.completion?.newsPercent === "number" ? summary.completion.newsPercent : null,
      earningsReductionPct: typeof summary?.completion?.earningsPercent === "number" ? summary.completion.earningsPercent : null,
      recentIpos,
      newsResolved,
      newsAttempted,
      unresolved,
      completionPct,
      latestBatch,
      latestSymbols,
      heartbeatAt,
      liveNow,
      livePhase,
    };
  }, [checkpoint, data?.generatedAt, status, summary]);

  return (
    <section className="space-y-6 text-slate-100">
      <header className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,160,0.12),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.96))] p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">Coverage Monitor</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Backfill Campaign Live</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-400">
              Watching strict coverage targets live: at least 4 direct ticker-specific news items per symbol and 8 earnings history rows per symbol, excluding recent IPOs.
            </p>
          </div>
          <div className={derived.liveNow ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-200" : "rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-200"}>
            {loading ? "Loading…" : derived.liveNow ? `Live now • refresh in ${countdown}s` : `Waiting for next write • refresh in ${countdown}s`}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span>Heartbeat {formatTimestamp(derived.heartbeatAt)}</span>
          <span>Phase {derived.livePhase}</span>
          <span>Resolved {formatNumber(derived.newsResolved)}</span>
          <span>Latest batch {formatNumber(derived.latestBatch?.batch_index)}</span>
          <span>Last symbols {(derived.latestSymbols || []).slice(-3).join(", ") || "—"}</span>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Missing News</p>
          <p className="mt-3 text-4xl font-semibold text-emerald-300">{formatNumber(derived.currentNews ?? undefined)}</p>
          <p className="mt-2 text-xs text-slate-400">Start {formatNumber(derived.baselineNews ?? undefined)} • {formatPercent(derived.newsReductionPct)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Missing Earnings</p>
          <p className="mt-3 text-4xl font-semibold text-sky-300">{formatNumber(derived.currentEarnings ?? undefined)}</p>
          <p className="mt-2 text-xs text-slate-400">Start {formatNumber(derived.baselineEarnings ?? undefined)} • {formatPercent(derived.earningsReductionPct)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">News Progress</p>
          <p className="mt-3 text-4xl font-semibold text-white">{formatNumber((derived.baselineNews !== null && derived.currentNews !== null) ? derived.baselineNews - derived.currentNews : undefined)}</p>
          <p className="mt-2 text-xs text-slate-400">Resolved: {formatNumber(derived.newsResolved)} • Attempted: {formatNumber(derived.newsAttempted)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Recent IPO Exemptions</p>
          <p className="mt-3 text-4xl font-semibold text-amber-300">{formatNumber(derived.recentIpos ?? undefined)}</p>
          <p className="mt-2 text-xs text-slate-400">Coverage completion: {formatPercent(derived.completionPct)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.12),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,0.95),_rgba(2,6,23,0.95))] p-6 shadow-[0_20px_60px_rgba(2,6,23,0.35)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300/80">Phase 2 Backfill</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Strategy backtesting engine job</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Detached background job for the full Phase 2 historical backfill. Progress is checkpoint-driven, resumable, and monitored independently from the coverage campaign.
            </p>
          </div>
          <div className={backfillLive ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-200" : "rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs font-medium text-slate-300"}>
            {backfillLive ? `Running • pid ${backfillStatus?.pid || "—"}` : backfillStatus?.status ? `Status ${backfillStatus.status}` : "Not started"}
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Processed Symbols</p>
            <p className="mt-3 text-4xl font-semibold text-sky-300">{formatNumber(backfillSummary?.processedSymbols ?? undefined)}</p>
            <p className="mt-2 text-xs text-slate-400">of {formatNumber(backfillSummary?.totalSymbols ?? undefined)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Signals Persisted</p>
            <p className="mt-3 text-4xl font-semibold text-emerald-300">{formatNumber(backfillSummary?.persistedSignals ?? undefined)}</p>
            <p className="mt-2 text-xs text-slate-400">Last symbol {backfillSummary?.lastCompletedSymbol || "—"}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Progress</p>
            <p className="mt-3 text-4xl font-semibold text-white">{formatPercent(backfillSummary?.progressPercent ?? null)}</p>
            <p className="mt-2 text-xs text-slate-400">Checkpoint {formatTimestamp(backfillCheckpoint?.updatedAt)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Peak Memory</p>
            <p className="mt-3 text-4xl font-semibold text-amber-300">{typeof backfillSummary?.peakMemoryMb === "number" ? `${backfillSummary.peakMemoryMb.toFixed(1)}mb` : "—"}</p>
            <p className="mt-2 text-xs text-slate-400">Resumed {backfillSummary?.resumedFromCheckpoint ? "yes" : "no"}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Backfill File Watch</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              {Object.entries(backfillJob?.files || {}).map(([name, details]) => (
                <div key={name} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium uppercase tracking-[0.16em] text-slate-400">{name}</span>
                    <span className={details.exists ? "text-emerald-300" : "text-rose-300"}>{details.exists ? "present" : "missing"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>Updated {formatTimestamp(details.updatedAt)}</span>
                    <span>{formatNumber(details.sizeBytes)} bytes</span>
                  </div>
                </div>
              ))}
            </div>
            {backfillStatus?.error ? (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{backfillStatus.error}</div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Backfill Log Tail</p>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-300">
              {(backfillJob?.stdoutTail || []).length ? (
                (backfillJob?.stdoutTail || []).map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))
              ) : (
                <div className="text-slate-500">No backfill stdout lines captured yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Current Status</p>
              <p className="mt-1 text-lg font-semibold text-white">{derived.livePhase}</p>
            </div>
            <div className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300">
              Updated {formatTimestamp(derived.heartbeatAt)}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Cycle</span>
                <span className="font-semibold text-white">{formatNumber(status?.cycle ?? checkpoint?.supervisor?.cycles_completed)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Retry attempted news</span>
                <span className="font-semibold text-white">{(status?.retry_attempted_news ?? checkpoint?.supervisor?.retry_attempted_news) ? "yes" : "no"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>News batch size</span>
                <span className="font-semibold text-white">{formatNumber(status?.news_batch_size ?? checkpoint?.supervisor?.effective_news_batch_size)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Live news progress</span>
                <span className="font-semibold text-white">{formatNumber(status?.news_progress)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>No-progress cycles</span>
                <span className="font-semibold text-white">{formatNumber(status?.no_progress_cycles ?? checkpoint?.supervisor?.no_progress_cycles)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Resolved news symbols</span>
                <span className="font-semibold text-emerald-300">{formatNumber(derived.newsResolved)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Unresolved news symbols</span>
                <span className="font-semibold text-rose-300">{formatNumber(derived.unresolved)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Earnings phase complete</span>
                <span className="font-semibold text-white">{checkpoint?.earnings?.completed ? "yes" : "no"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Last hourly report</span>
                <span className="font-semibold text-white">{formatTimestamp(checkpoint?.supervisor?.last_hourly_report_at)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Last batch inserted</span>
                <span className="font-semibold text-white">{formatNumber(derived.latestBatch?.total_inserted_primary)}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Latest Batch</span>
              <span className={derived.liveNow ? "text-emerald-300" : "text-amber-300"}>{derived.liveNow ? "active" : "idle"}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="flex items-center justify-between">
                <span>Batch index</span>
                <span className="font-semibold text-white">{formatNumber(derived.latestBatch?.batch_index)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Resolved in batch</span>
                <span className="font-semibold text-emerald-300">{formatNumber(derived.latestBatch?.resolved_symbols?.length)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Started</span>
                <span className="font-semibold text-white">{formatTimestamp(derived.latestBatch?.started_at)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Completed</span>
                <span className="font-semibold text-white">{formatTimestamp(derived.latestBatch?.completed_at)}</span>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400">
              Symbols {(derived.latestSymbols || []).length ? derived.latestSymbols.join(", ") : "—"}
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Hourly / Progress History</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm text-slate-300">
                <thead className="text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Cycle</th>
                    <th className="py-2 pr-4">Phase</th>
                    <th className="py-2 pr-4">Missing News</th>
                    <th className="py-2 pr-4">Missing Earnings</th>
                    <th className="py-2 pr-4">News Progress</th>
                    <th className="py-2">Earnings Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {hourly.slice().reverse().map((entry, index) => (
                    <tr key={`${String(entry.generated_at || index)}`} className="border-t border-slate-800/80">
                      <td className="py-2 pr-4">{formatTimestamp(String(entry.generated_at || ""))}</td>
                      <td className="py-2 pr-4">{formatNumber(Number(entry.cycle || 0))}</td>
                      <td className="py-2 pr-4">{String(entry.phase || "cycle")}</td>
                      <td className="py-2 pr-4 text-emerald-300">{formatNumber(Number(entry.missing_news_count || 0))}</td>
                      <td className="py-2 pr-4 text-sky-300">{formatNumber(Number(entry.missing_earnings_count || 0))}</td>
                      <td className="py-2 pr-4">{formatNumber(Number(entry.news_progress || 0))}</td>
                      <td className="py-2">{formatNumber(Number(entry.earnings_progress || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">File Watch</p>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              {Object.entries(data?.files || {}).map(([name, details]) => (
                <div key={name} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium uppercase tracking-[0.16em] text-slate-400">{name}</span>
                    <span className={details.exists ? "text-emerald-300" : "text-rose-300"}>{details.exists ? "present" : "missing"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>Updated {formatTimestamp(details.updatedAt)}</span>
                    <span>{formatNumber(details.sizeBytes)} bytes</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Recent Log Tail</p>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-300">
              {(data?.stdoutTail || []).length ? (
                (data?.stdoutTail || []).map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))
              ) : (
                <div className="text-slate-500">No stdout lines captured yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}