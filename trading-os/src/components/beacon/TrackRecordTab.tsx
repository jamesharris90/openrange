"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  BEACON_QUERY_OPTIONS,
  fetchBeaconStrategies,
  fetchBeaconTrackRecord,
} from "@/components/beacon/beacon-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WINDOWS = [30, 60, 90] as const;

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function outcomeClass(value: string): string {
  if (value === "win") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (value === "loss") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-slate-700 bg-slate-800/80 text-slate-300";
}

function TrackSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded bg-slate-800/60" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function TrackRecordTab() {
  const [strategyId, setStrategyId] = useState("");
  const [days, setDays] = useState<number>(30);
  const strategiesQuery = useQuery({
    queryKey: ["beacon", "strategies", "track-filter"],
    queryFn: fetchBeaconStrategies,
    ...BEACON_QUERY_OPTIONS,
  });
  const trackRecordQuery = useQuery({
    queryKey: ["beacon", "track-record", strategyId, days],
    queryFn: () => fetchBeaconTrackRecord(strategyId, days),
    ...BEACON_QUERY_OPTIONS,
  });

  const strategyOptions = useMemo(() => strategiesQuery.data?.strategies || [], [strategiesQuery.data?.strategies]);
  const strategyNameById = useMemo(
    () => new Map(strategyOptions.map((strategy) => [strategy.strategy_id, strategy.strategy_name])),
    [strategyOptions]
  );

  if (trackRecordQuery.isLoading) {
    return <TrackSkeleton />;
  }

  if (trackRecordQuery.isError || !trackRecordQuery.data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-4 text-sm text-red-200">
          Beacon is temporarily unavailable. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const track = trackRecordQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg text-slate-100">TRACK RECORD — Last {days} days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={strategyId}
                onChange={(event) => setStrategyId(event.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">All Strategies</option>
                {strategyOptions.map((strategy) => (
                  <option key={strategy.strategy_id} value={strategy.strategy_id}>
                    {strategy.strategy_name}
                  </option>
                ))}
              </select>
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                {WINDOWS.map((window) => (
                  <button
                    key={window}
                    type="button"
                    onClick={() => setDays(window)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm transition",
                      days === window ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {window}d
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              ["Total Picks", track.total_picks.toLocaleString("en-GB")],
              ["Win Rate", `${track.win_rate.toFixed(1)}%`],
              ["Profit Factor", track.profit_factor == null ? "—" : track.profit_factor.toFixed(2)],
              ["Avg Winner R", track.avg_winner_r.toFixed(2)],
              ["Avg Loser R", track.avg_loser_r.toFixed(2)],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold text-slate-100">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-slate-800/80 bg-slate-950/40">
            <CardHeader>
              <CardTitle className="text-sm text-slate-200">Equity Curve</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={track.equity_curve}>
                  <CartesianGrid stroke="rgba(51,65,85,0.35)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b", borderRadius: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Line type="monotone" dataKey="cumulative_r" stroke="#22d3ee" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-3 py-3">Pick Date</th>
                  <th className="px-3 py-3">Symbol</th>
                  <th className="px-3 py-3">Strategy</th>
                  <th className="px-3 py-3">Direction</th>
                  <th className="px-3 py-3">Outcome</th>
                  <th className="px-3 py-3">Entry</th>
                  <th className="px-3 py-3">Exit</th>
                  <th className="px-3 py-3">R-Multiple</th>
                </tr>
              </thead>
              <tbody>
                {track.recent_picks.map((pick) => (
                  <tr key={`${pick.symbol}-${pick.strategy_id}-${pick.pick_date}-${pick.exit_price}`} className="border-b border-slate-900/80 text-slate-300 last:border-0">
                    <td className="px-3 py-4">{pick.pick_date || "—"}</td>
                    <td className="px-3 py-4 font-mono text-cyan-300">{pick.symbol}</td>
                    <td className="px-3 py-4">{strategyNameById.get(pick.strategy_id) || pick.strategy_id}</td>
                    <td className="px-3 py-4">{pick.direction || "—"}</td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded border px-2.5 py-1 text-xs font-semibold ${outcomeClass(pick.outcome)}`}>
                        {pick.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-4">{formatPrice(pick.entry_price)}</td>
                    <td className="px-3 py-4">{formatPrice(pick.exit_price)}</td>
                    <td className="px-3 py-4">{pick.r_multiple == null ? "—" : pick.r_multiple.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}