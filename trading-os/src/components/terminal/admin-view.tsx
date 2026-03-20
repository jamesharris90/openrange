"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { getEmailAnalytics, getOpportunityEngineStatus, getSystemDiagnostics, triggerBroadcast } from "@/lib/api/admin";
import { percentSafe } from "@/lib/number";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function AdminView() {
  const { data: diagnostics = [] } = useQuery({
    queryKey: ["medium", "diagnostics"],
    queryFn: getSystemDiagnostics,
    ...QUERY_POLICY.medium,
    refetchInterval: 15_000,
  });

  const { data: analytics } = useQuery({
    queryKey: ["medium", "emailAnalytics"],
    queryFn: getEmailAnalytics,
    ...QUERY_POLICY.medium,
    refetchInterval: 15_000,
  });

  const { data: opportunityStatus } = useQuery({
    queryKey: ["medium", "opportunityEngineStatus"],
    queryFn: getOpportunityEngineStatus,
    ...QUERY_POLICY.medium,
    refetchInterval: 15_000,
  });

  const broadcast = useMutation({
    mutationFn: (type: "newsletter" | "signals_digest") => triggerBroadcast(type),
  });

  const totalOpportunitiesText =
    typeof opportunityStatus?.totalOpportunities === "number"
      ? String(opportunityStatus.totalOpportunities)
      : "No data";
  const lastUpdatedText = opportunityStatus?.lastUpdated || "No data";
  const topSymbolText = opportunityStatus?.topSymbol || "No data";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">Data Integrity Monitor</div>
          <Link href="/admin/data-health" className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-900">
            Open Data Health Panel
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">System Diagnostics</div>
          <div className="space-y-2">
            {diagnostics.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-lg border border-slate-800 p-2 text-xs">
                <span className="text-slate-300">{item.name}</span>
                <span className={item.status === "ok" ? "text-bull" : "text-bear"}>{item.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Email Analytics</div>
          <div className="grid gap-2 text-xs text-slate-300 md:grid-cols-3">
            <div className="rounded-lg border border-slate-800 p-2">Open Rate: {percentSafe(analytics?.open_rate ?? 0, 2)}</div>
            <div className="rounded-lg border border-slate-800 p-2">Click Rate: {percentSafe(analytics?.click_rate ?? 0, 2)}</div>
            <div className="rounded-lg border border-slate-800 p-2">Subscriber Growth: {percentSafe(analytics?.subscriber_growth ?? 0, 2)}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => broadcast.mutate("newsletter")}>Schedule Newsletter</Button>
            <Button variant="outline" onClick={() => broadcast.mutate("signals_digest")}>Schedule Signals Digest</Button>
            <Button variant="secondary" onClick={() => broadcast.mutate("newsletter")}>Manual Broadcast</Button>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Opportunity Engine Status</div>
          <div className="grid gap-2 text-xs text-slate-300">
            <div className="rounded-lg border border-slate-800 p-2">Total opportunities: {totalOpportunitiesText}</div>
            <div className="rounded-lg border border-slate-800 p-2">Last updated: {lastUpdatedText}</div>
            <div className="rounded-lg border border-slate-800 p-2">Top symbol: {topSymbolText}</div>
          </div>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          "System Overview",
          "Engines Monitor",
          "Signals Monitor",
          "Users",
          "Data Health",
          "Logs",
          "Settings",
        ].map((name) => (
          <article key={name} className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
            <div className="text-xs uppercase tracking-wide text-slate-400">{name}</div>
            <div className="mt-2 text-sm text-slate-200">Operational</div>
          </article>
        ))}
      </section>
    </div>
  );
}
