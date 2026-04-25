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
          const signalEvidence = getSignalEvidence(pick);

          return (
            <div key={`${pick.symbol}-${pick.pattern}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <div className="font-mono text-lg font-semibold text-cyan-300">{pick.symbol}</div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{pick.pattern}</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{pick.reasoning}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                  Alignment: {alignmentCount} signals
                </span>
                <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1">Confidence: {pick.confidence}</span>
                <span className="rounded border border-slate-800 bg-slate-900 px-2 py-1">
                  Signals: {pick.signals_aligned.length ? pick.signals_aligned.join(", ") : "—"}
                </span>
              </div>
              {signalEvidence.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {signalEvidence.slice(0, 4).map((evidence, index) => (
                    <div key={`${pick.symbol}-${evidence.signal || index}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-200">{evidence.signal || "Signal"}</span>
                        <span className="text-slate-500">Rank {evidence.rank ?? "—"}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
                        {evidence.reasoning || evidence.category || "Signal evidence available."}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}