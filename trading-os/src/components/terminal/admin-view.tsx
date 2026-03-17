"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { getEmailAnalytics, getSystemDiagnostics, triggerBroadcast } from "@/lib/api/admin";
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

  const broadcast = useMutation({
    mutationFn: (type: "newsletter" | "signals_digest") => triggerBroadcast(type),
  });

  return (
    <div className="space-y-4">
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
            <div className="rounded-lg border border-slate-800 p-2">Open Rate: {(analytics?.open_rate ?? 0).toFixed(2)}%</div>
            <div className="rounded-lg border border-slate-800 p-2">Click Rate: {(analytics?.click_rate ?? 0).toFixed(2)}%</div>
            <div className="rounded-lg border border-slate-800 p-2">Subscriber Growth: {(analytics?.subscriber_growth ?? 0).toFixed(2)}%</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => broadcast.mutate("newsletter")}>Schedule Newsletter</Button>
            <Button variant="outline" onClick={() => broadcast.mutate("signals_digest")}>Schedule Signals Digest</Button>
            <Button variant="secondary" onClick={() => broadcast.mutate("newsletter")}>Manual Broadcast</Button>
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
