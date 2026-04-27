"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { apiFetch, apiGet } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface V0Pick {
  pick_id: string;
  symbol: string;
  pattern: string;
  confidence: string;
  reasoning: string;
  signals_aligned: string[];
  forward_count?: number;
  backward_count?: number;
  latest_close?: number | null;
  prior_close?: number | null;
  change_pct?: number | null;
  sparkline?: number[];
  metadata: Record<string, unknown>;
  narrative_thesis?: string | null;
  narrative_watch_for?: string | null;
  narrative_generated_at?: string | null;
  top_catalyst_tier?: number | null;
  top_catalyst_rank?: number | null;
  top_catalyst_reasons?: string[] | null;
  top_catalyst_computed_at?: string | null;
  created_at: string;
  run_id?: string | null;
}

interface SignalEvidence {
  signal?: string;
  category?: string | null;
  rank?: number | null;
  score?: number | null;
  reasoning?: string | null;
}

interface V0Response {
  picks: V0Pick[];
  count: number;
  version: string;
  generated_at: string | null;
  run_id?: string | null;
}

const FORWARD_LOOKING_SIGNALS = new Set([
  "earnings_upcoming_within_3d",
  "top_coiled_spring",
  "top_volume_building",
]);

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAlignmentCount(pick: V0Pick): number {
  const alignment = isRecord(pick.metadata.alignment) ? pick.metadata.alignment : null;
  const count = alignment?.alignmentCount;
  return typeof count === "number" ? count : pick.signals_aligned.length;
}

function getAlignmentBadgeClass(count: number): string {
  if (count >= 4) {
    return "border-emerald-300/70 bg-emerald-500/25 text-emerald-100 shadow-[0_0_24px_rgba(16,185,129,0.24)]";
  }
  if (count === 3) {
    return "border-blue-300/70 bg-blue-500/25 text-blue-100 shadow-[0_0_24px_rgba(59,130,246,0.22)]";
  }
  return "border-slate-600/60 bg-slate-800/70 text-slate-200";
}

function isForwardLookingSignal(signal: string | null | undefined): boolean {
  return typeof signal === "string" && FORWARD_LOOKING_SIGNALS.has(signal);
}

function getSignalEvidence(pick: V0Pick): SignalEvidence[] {
  const rawEvidence = pick.metadata.signal_evidence;
  if (!Array.isArray(rawEvidence)) return [];

  return rawEvidence
    .filter(isRecord)
    .map((item) => ({
      signal: typeof item.signal === "string" ? item.signal : undefined,
      category: typeof item.category === "string" ? item.category : null,
      rank: typeof item.rank === "number" ? item.rank : null,
      score: typeof item.score === "number" ? item.score : null,
      reasoning: typeof item.reasoning === "string" ? item.reasoning : null,
    }));
}

async function fetchV0Picks(): Promise<V0Response> {
  return apiGet<V0Response>("/api/beacon-v0/picks");
}

function Sparkline({ values, isPositive }: { values: number[]; isPositive: boolean }) {
  if (!values || values.length < 2) return null;

  const width = 80;
  const height = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="opacity-80" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={isPositive ? "#34d399" : "#f87171"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function V0TopCatalystCard({ pick }: { pick: V0Pick }) {
  const reasons = Array.isArray(pick.top_catalyst_reasons) ? pick.top_catalyst_reasons : [];
  const tier = pick.top_catalyst_tier === 1 ? 1 : 2;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex gap-4">
        <div className="shrink-0 font-mono text-lg font-black text-slate-400">
          #{pick.top_catalyst_rank ?? "—"}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-3">
              <Link href={`/research-v2/${pick.symbol}`} className="font-mono text-xl font-bold text-cyan-300 hover:underline">
                {pick.symbol}
              </Link>
              {pick.latest_close != null && (
                <span className="text-lg font-medium text-zinc-200">${pick.latest_close.toFixed(2)}</span>
              )}
              {pick.change_pct != null && (
                <span className={pick.change_pct >= 0 ? "text-sm font-medium text-emerald-400" : "text-sm font-medium text-red-400"}>
                  {pick.change_pct >= 0 ? "+" : ""}{pick.change_pct.toFixed(2)}%
                </span>
              )}
            </div>
            <span className={`inline-flex w-fit items-center rounded-xl border px-4 py-1.5 text-sm font-black uppercase tracking-[0.2em] ${getAlignmentBadgeClass(tier === 1 ? 4 : 3)}`}>
              TIER {tier}
            </span>
          </div>
          {reasons.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {reasons.map((reason) => (
                <span key={`${pick.pick_id}-${reason}`} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
                  {reason}
                </span>
              ))}
            </div>
          ) : null}
          {pick.narrative_thesis ? (
            <p className="text-sm leading-relaxed text-zinc-100">{pick.narrative_thesis}</p>
          ) : (
            <p className="text-sm italic text-zinc-400">{pick.reasoning || "Narrative pending..."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

type RegenerateNarrativeResponse = {
  narrative_thesis: string | null;
  narrative_watch_for: string | null;
  narrative_generated_at: string | null;
};

function V0PickCard({ pick }: { pick: V0Pick }) {
  const [regenerating, setRegenerating] = useState(false);
  const [localPick, setLocalPick] = useState(pick);
  const alignmentCount = getAlignmentCount(localPick);
  const signalEvidence = getSignalEvidence(localPick);

  useEffect(() => {
    setLocalPick(pick);
  }, [pick]);

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);

    try {
      const response = await apiFetch(
        `/api/v2/beacon-v0/regenerate-narrative/${encodeURIComponent(localPick.pick_id)}`,
        {
          method: "POST",
          credentials: "include",
        },
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || errorBody.error || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as RegenerateNarrativeResponse;
      setLocalPick((previous) => ({
        ...previous,
        narrative_thesis: data.narrative_thesis,
        narrative_watch_for: data.narrative_watch_for,
        narrative_generated_at: data.narrative_generated_at,
      }));
      alert("Narrative regenerated");
    } catch (error) {
      console.error("[beacon] regenerate failed:", error);
      alert(`Regenerate failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href={`/research-v2/${localPick.symbol}`} className="font-mono text-xl font-bold text-cyan-300 hover:underline">
            {localPick.symbol}
          </Link>
          {localPick.latest_close != null && (
            <span className="text-lg font-medium text-zinc-200">${localPick.latest_close.toFixed(2)}</span>
          )}
          {localPick.change_pct != null && (
            <span className={localPick.change_pct >= 0 ? "text-sm font-medium text-emerald-400" : "text-sm font-medium text-red-400"}>
              {localPick.change_pct >= 0 ? "+" : ""}{localPick.change_pct.toFixed(2)}%
            </span>
          )}
          {localPick.sparkline && localPick.sparkline.length > 1 && (
            <Sparkline values={localPick.sparkline} isPositive={(localPick.change_pct ?? 0) >= 0} />
          )}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-xl border px-4 py-1.5 text-sm font-black uppercase tracking-[0.2em] ${getAlignmentBadgeClass(alignmentCount)}`}>
              Alignment · {alignmentCount} {alignmentCount === 1 ? "Signal" : "Signals"}
            </span>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
              title="Regenerate narrative"
              aria-label="Regenerate narrative"
            >
              <RefreshCw size={14} className={regenerating ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{localPick.pattern}</div>
        </div>
      </div>
      <div className={`mt-3 transition-opacity duration-200 ${regenerating ? "opacity-40" : "opacity-100"}`}>
        {localPick.narrative_thesis ? (
          <>
            <p className="text-sm leading-relaxed text-zinc-100">
              {localPick.narrative_thesis}
            </p>
            {localPick.narrative_watch_for ? (
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                <span className="mr-1 uppercase tracking-wider text-zinc-500">Watch for:</span>
                {localPick.narrative_watch_for}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm italic text-zinc-400">
            {localPick.reasoning || "Narrative pending..."}
          </p>
        )}
      </div>
      {signalEvidence.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {signalEvidence.slice(0, 4).map((evidence, index) => {
            const forwardLooking = isForwardLookingSignal(evidence.signal);

            return (
              <div
                key={`${localPick.symbol}-${evidence.signal || index}`}
                className={`rounded-lg border p-3 ${
                  forwardLooking
                    ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                    : "border-slate-800 bg-slate-900/70"
                }`}
              >
                <div className="flex items-start justify-between gap-2 text-xs">
                  <div>
                    <span className={forwardLooking ? "font-medium text-emerald-100" : "font-medium text-slate-200"}>
                      {evidence.signal || "Signal"}
                    </span>
                    <div className="mt-1">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        forwardLooking
                          ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                          : "border-slate-700 bg-slate-800 text-slate-400"
                      }`}>
                        {forwardLooking ? "Forward setup" : "Observed move"}
                      </span>
                    </div>
                  </div>
                  <span className="text-slate-500">Rank {evidence.rank ?? "—"}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
                  {evidence.reasoning || evidence.category || "Signal evidence available."}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function V0PreviewTab() {
  const query = useQuery({
    queryKey: ["beacon", "v0", "picks"],
    queryFn: fetchV0Picks,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="h-6 w-56 animate-pulse rounded bg-slate-800/70" />
          <div className="h-4 w-72 animate-pulse rounded bg-slate-800/70" />
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded bg-slate-800/60" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-200">
          Beacon v0 is temporarily unavailable. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const data = query.data;
  const topCatalystPicks = data.picks
    .filter((pick) => pick.top_catalyst_tier && pick.top_catalyst_rank)
    .sort((a, b) => Number(a.top_catalyst_rank || 999) - Number(b.top_catalyst_rank || 999))
    .slice(0, 5);

  if (data.picks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg text-slate-100">BEACON v0 PREVIEW</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-400">
          No v0 picks yet. The first Beacon v0 run has not completed.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg text-slate-100">BEACON v0 PREVIEW</CardTitle>
            <p className="mt-1 text-sm text-slate-400">
              {data.count} picks · generated {formatTimestamp(data.generated_at)}
            </p>
          </div>
          <Badge variant="accent" className="w-fit uppercase tracking-[0.18em]">
            {data.version}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {topCatalystPicks.length > 0 ? (
          <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="mb-4">
              <h3 className="text-sm font-black uppercase tracking-[0.24em] text-slate-100">Today&apos;s Top Catalysts</h3>
              <p className="mt-1 text-xs text-slate-500">Highest-conviction Beacon v0 picks for today&apos;s session.</p>
            </div>
            <div className="space-y-3">
              {topCatalystPicks.map((pick) => (
                <V0TopCatalystCard key={`top-${pick.pick_id || `${pick.symbol}-${pick.pattern}`}`} pick={pick} />
              ))}
            </div>
          </div>
        ) : null}
        {data.picks.map((pick) => (
          <V0PickCard key={pick.pick_id || `${pick.symbol}-${pick.pattern}`} pick={pick} />
        ))}
      </CardContent>
    </Card>
  );
}