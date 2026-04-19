"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  BEACON_QUERY_OPTIONS,
  fetchBeaconPicks,
  fetchBeaconStrategies,
} from "@/components/beacon/beacon-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

function gradeVariant(grade: string | null | undefined) {
  if (grade === "A") return "success" as const;
  if (grade === "B") return "accent" as const;
  if (grade === "D" || grade === "F") return "danger" as const;
  return "default" as const;
}

function confidenceClass(value: number | null | undefined): string {
  if (value == null) return "border-slate-700 bg-slate-800/70 text-slate-300";
  if (value >= 80) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (value >= 60) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-red-500/30 bg-red-500/10 text-red-300";
}

function directionClass(value: string | null | undefined): string {
  return value === "SHORT"
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function PicksSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="h-6 w-56 animate-pulse rounded bg-slate-800/70" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-800/70" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded bg-slate-800/60" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function MorningPicksTab({ onViewGrades }: { onViewGrades?: () => void }) {
  const picksQuery = useQuery({
    queryKey: ["beacon", "picks", "today"],
    queryFn: () => fetchBeaconPicks(),
    ...BEACON_QUERY_OPTIONS,
  });

  const strategiesQuery = useQuery({
    queryKey: ["beacon", "strategies", "empty-state"],
    queryFn: fetchBeaconStrategies,
    ...BEACON_QUERY_OPTIONS,
  });

  const gradeCounts = useMemo(() => {
    const strategies = strategiesQuery.data?.strategies || [];
    const ab = strategies.filter((row) => row.grade === "A" || row.grade === "B").length;
    return { tracked: strategies.length, ab };
  }, [strategiesQuery.data?.strategies]);

  if (picksQuery.isLoading) {
    return <PicksSkeleton />;
  }

  if (picksQuery.isError || !picksQuery.data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-200">
          Beacon is temporarily unavailable. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const { pick_date, generated_at, picks } = picksQuery.data;

  if (picks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg text-slate-100">MORNING PICKS — {formatDate(pick_date)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-300">
          <div>
            <div className="text-base font-semibold text-slate-100">No picks today</div>
            <p className="mt-2 max-w-2xl leading-6 text-slate-400">
              Beacon requires strategies to maintain a 55%+ win rate and 1.5+ profit factor over a 30-day rolling window before generating picks.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-slate-300">
            Current status: {gradeCounts.tracked} strategies tracked, {gradeCounts.ab} showing A/B grades.
          </div>
          <Button variant="outline" onClick={onViewGrades}>
            View Strategy Grades →
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-slate-100">MORNING PICKS — {formatDate(pick_date)}</CardTitle>
        <div className="text-sm text-slate-400">
          Generated at {formatTimestamp(generated_at)} · Next update: Tomorrow 06:15 UTC
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-3 py-3">Rank</th>
                <th className="px-3 py-3">Symbol</th>
                <th className="px-3 py-3">Strategy</th>
                <th className="px-3 py-3">Direction</th>
                <th className="px-3 py-3">Entry</th>
                <th className="px-3 py-3">Stop</th>
                <th className="px-3 py-3">Target</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="px-3 py-3">Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((pick) => (
                <tr key={`${pick.symbol}-${pick.strategy_id}-${pick.rank}`} className="border-b border-slate-900/80 text-slate-300 last:border-0">
                  <td className="px-3 py-4 text-slate-100">{pick.rank ?? "—"}</td>
                  <td className="px-3 py-4">
                    <Link href={`/research/${encodeURIComponent(pick.symbol)}`} className="font-mono font-semibold text-cyan-300 hover:text-cyan-200 hover:underline">
                      {pick.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-2">
                      <span>{pick.strategy_name}</span>
                      <Badge variant={gradeVariant(pick.strategy_grade)}>{pick.strategy_grade || "—"}</Badge>
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded border px-2.5 py-1 text-xs font-semibold ${directionClass(pick.direction)}`}>
                      {pick.direction || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-4">{formatPrice(pick.entry_price)}</td>
                  <td className="px-3 py-4">{formatPrice(pick.stop_price)}</td>
                  <td className="px-3 py-4">{formatPrice(pick.target_price)}</td>
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded border px-2.5 py-1 text-xs font-semibold ${confidenceClass(pick.confidence_score)}`}>
                      {pick.confidence_score == null ? "—" : Math.round(pick.confidence_score)}
                    </span>
                  </td>
                  <td className="px-3 py-4">{formatPercent(pick.strategy_win_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}