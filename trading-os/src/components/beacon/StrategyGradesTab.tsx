"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { BEACON_QUERY_OPTIONS, fetchBeaconStrategies, type BeaconStrategy } from "@/components/beacon/beacon-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SortKey =
  | "strategy_name"
  | "category"
  | "grade"
  | "win_rate"
  | "profit_factor"
  | "total_signals"
  | "avg_r_multiple"
  | "thirty_day_pnl_r"
  | "trend";

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

function gradeClass(grade: string): string {
  if (grade === "A") return "text-emerald-300";
  if (grade === "B") return "text-cyan-300";
  if (grade === "C") return "text-amber-300";
  if (grade === "D") return "text-orange-300";
  return "text-red-300";
}

function trendDisplay(value: BeaconStrategy["trend"]): string {
  if (value === "improving") return "↑ improving";
  if (value === "declining") return "↓ declining";
  if (value === "new") return "✨ new";
  return "→ stable";
}

function compareStrategies(left: BeaconStrategy, right: BeaconStrategy, key: SortKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const gradeRank = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  const trendRank = { improving: 1, stable: 2, declining: 3, new: 4 };

  const leftValue = key === "grade"
    ? gradeRank[left.grade as keyof typeof gradeRank] ?? 99
    : key === "trend"
      ? trendRank[left.trend]
      : left[key];
  const rightValue = key === "grade"
    ? gradeRank[right.grade as keyof typeof gradeRank] ?? 99
    : key === "trend"
      ? trendRank[right.trend]
      : right[key];

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * multiplier;
  }

  return String(leftValue).localeCompare(String(rightValue)) * multiplier;
}

function StrategiesSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="h-6 w-64 animate-pulse rounded bg-slate-800/70" />
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded bg-slate-800/60" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function StrategyGradesTab() {
  const [sortKey, setSortKey] = useState<SortKey>("grade");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const strategiesQuery = useQuery({
    queryKey: ["beacon", "strategies"],
    queryFn: fetchBeaconStrategies,
    ...BEACON_QUERY_OPTIONS,
  });

  const sortedStrategies = useMemo(() => {
    const rows = [...(strategiesQuery.data?.strategies || [])];
    return rows.sort((left, right) => compareStrategies(left, right, sortKey, sortDirection));
  }, [strategiesQuery.data?.strategies, sortDirection, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "grade" ? "asc" : "desc");
  };

  if (strategiesQuery.isLoading) {
    return <StrategiesSkeleton />;
  }

  if (strategiesQuery.isError || !strategiesQuery.data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-200">
          Beacon is temporarily unavailable. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-slate-100">STRATEGY GRADES — Last scored {formatTimestamp(strategiesQuery.data.scored_at)}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-[0.18em] text-slate-500">
              <tr>
                {[
                  ["strategy_name", "Strategy Name"],
                  ["category", "Category"],
                  ["grade", "Grade"],
                  ["win_rate", "Win Rate"],
                  ["profit_factor", "Profit Factor"],
                  ["total_signals", "Total Signals"],
                  ["avg_r_multiple", "Avg R"],
                  ["thirty_day_pnl_r", "30-Day R P&L"],
                  ["trend", "Trend"],
                ].map(([key, label]) => (
                  <th key={key} className="px-3 py-3">
                    <button type="button" onClick={() => toggleSort(key as SortKey)} className="transition hover:text-slate-200">
                      {label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedStrategies.map((strategy) => (
                <tr key={strategy.strategy_id} className="border-b border-slate-900/80 text-slate-300 last:border-0">
                  <td className="px-3 py-4 font-medium text-slate-100">{strategy.strategy_name}</td>
                  <td className="px-3 py-4">
                    <Badge className="border-slate-700 bg-slate-800/80 text-slate-300">{strategy.category}</Badge>
                  </td>
                  <td className={`px-3 py-4 text-xl font-semibold ${gradeClass(strategy.grade)}`}>{strategy.grade}</td>
                  <td className="px-3 py-4">{strategy.win_rate.toFixed(1)}%</td>
                  <td className="px-3 py-4">{strategy.profit_factor == null ? "—" : strategy.profit_factor.toFixed(2)}</td>
                  <td className="px-3 py-4">{strategy.total_signals.toLocaleString("en-GB")}</td>
                  <td className="px-3 py-4">{strategy.avg_r_multiple.toFixed(2)}</td>
                  <td className="px-3 py-4">{strategy.thirty_day_pnl_r.toFixed(1)}</td>
                  <td className="px-3 py-4">{trendDisplay(strategy.trend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}