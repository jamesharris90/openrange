"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface V0Pick {
  symbol: string;
  pattern: string;
  confidence: string;
  reasoning: string;
  signals_aligned: string[];
  forward_count?: number;
  backward_count?: number;
  metadata: Record<string, unknown>;
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

function getForwardCount(pick: V0Pick): number {
  if (typeof pick.forward_count === "number") return pick.forward_count;
  return pick.signals_aligned.filter(isForwardLookingSignal).length;
}

function getBackwardCount(pick: V0Pick, alignmentCount: number, forwardCount: number): number {
  if (typeof pick.backward_count === "number") return pick.backward_count;
  return Math.max(alignmentCount - forwardCount, 0);
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
        {data.picks.map((pick) => {
          const alignmentCount = getAlignmentCount(pick);
          const forwardCount = getForwardCount(pick);
          const backwardCount = getBackwardCount(pick, alignmentCount, forwardCount);
          const signalEvidence = getSignalEvidence(pick);

          return (
            <div key={`${pick.symbol}-${pick.pattern}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="font-mono text-lg font-semibold text-cyan-300">{pick.symbol}</div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <span className={`inline-flex items-center rounded-xl border px-4 py-1.5 text-sm font-black uppercase tracking-[0.2em] ${getAlignmentBadgeClass(alignmentCount)}`}>
                    Alignment · {alignmentCount} {alignmentCount === 1 ? "Signal" : "Signals"}
                  </span>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{pick.pattern}</div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{pick.reasoning}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1">Confidence: {pick.confidence}</span>
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                  Forward-looking: {forwardCount}
                </span>
                <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300">
                  Already moved / observed: {backwardCount}
                </span>
                <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1">
                  Signals: {pick.signals_aligned.length ? pick.signals_aligned.join(", ") : "—"}
                </span>
              </div>
              {signalEvidence.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {signalEvidence.slice(0, 4).map((evidence, index) => {
                    const forwardLooking = isForwardLookingSignal(evidence.signal);

                    return (
                      <div
                        key={`${pick.symbol}-${evidence.signal || index}`}
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
        })}
      </CardContent>
    </Card>
  );
}