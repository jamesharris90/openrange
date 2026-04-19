"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { BEACON_QUERY_OPTIONS, fetchBeaconSummary } from "@/components/beacon/beacon-api";

type Tab = "picks" | "grades" | "track";

const TAB_LABELS: Array<{ key: Tab; label: string }> = [
  { key: "picks", label: "Morning Picks" },
  { key: "grades", label: "Strategy Grades" },
  { key: "track", label: "Track Record" },
];

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function isStaleScoreDate(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return Date.now() - parsed.getTime() > 2 * 24 * 60 * 60 * 1000;
}

function HeaderSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded bg-slate-800/70" />
        <div className="h-9 w-52 animate-pulse rounded bg-slate-800/70" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-800/70" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="h-3 w-24 animate-pulse rounded bg-slate-800/70" />
            </CardHeader>
            <CardContent>
              <div className="h-7 w-28 animate-pulse rounded bg-slate-800/70" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function BeaconHeader({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const summaryQuery = useQuery({
    queryKey: ["beacon", "summary"],
    queryFn: fetchBeaconSummary,
    ...BEACON_QUERY_OPTIONS,
  });

  const stale = useMemo(
    () => isStaleScoreDate(summaryQuery.data?.latest_score_date),
    [summaryQuery.data?.latest_score_date]
  );

  if (summaryQuery.isLoading) {
    return <HeaderSkeleton />;
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-200">
          Beacon is temporarily unavailable. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const summary = summaryQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge variant="accent" className="w-fit uppercase tracking-[0.18em]">BEACON AI</Badge>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">BEACON AI</h1>
            <p className="mt-1 text-sm text-slate-400">Algorithmic strategy intelligence</p>
          </div>
        </div>
        <div className="text-xs text-slate-500">
          Latest score date: <span className="text-slate-300">{formatDate(summary.latest_score_date)}</span>
        </div>
      </div>

      {stale ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 text-sm text-amber-200">
            Strategy grades last updated {formatDate(summary.latest_score_date)}. Nightly scoring may be delayed.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active Strategies", value: formatNumber(summary.active_strategies) },
          { label: "Signals Tracked", value: formatNumber(summary.signals_tracked) },
          { label: "Today’s Picks", value: formatNumber(summary.todays_picks) },
          { label: "30-Day Win Rate", value: formatPercent(summary.thirty_day_win_rate) },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{stat.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-slate-100">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-1">
        {TAB_LABELS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition",
              activeTab === tab.key
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-500 hover:text-slate-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}