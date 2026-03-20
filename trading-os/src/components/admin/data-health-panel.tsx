"use client";

import { useQuery } from "@tanstack/react-query";

import { getDataIntegrity } from "@/lib/api/dataIntegrity";
import { QUERY_POLICY } from "@/lib/queries/policy";

function statusClass(status: string) {
  if (status === "ok") return "text-emerald-300 border-emerald-600/40 bg-emerald-500/10";
  if (status === "degraded") return "text-amber-300 border-amber-500/40 bg-amber-400/10";
  return "text-rose-300 border-rose-600/40 bg-rose-500/10";
}

function formatLagMinutes(value: unknown) {
  const lag = Number(value);
  if (!Number.isFinite(lag)) return "unknown";
  if (lag < 60) return `${lag.toFixed(1)}m`;
  const hours = lag / 60;
  return `${hours.toFixed(1)}h`;
}

export function DataHealthPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["fast", "system", "data-integrity"],
    queryFn: getDataIntegrity,
    ...QUERY_POLICY.fast,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-panel p-4 text-sm text-slate-300 shadow-lg">
        Loading data integrity monitor...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-700/40 bg-rose-950/20 p-4 text-sm text-rose-200 shadow-lg">
        Failed to load data integrity monitor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Overall Status</div>
        <div className="flex items-center justify-between">
          <span className={`rounded-md border px-3 py-1 text-sm font-medium ${statusClass(data.status)}`}>
            {String(data.status).toUpperCase()}
          </span>
          <span className="text-xs text-slate-400">Checked: {new Date(data.checked_at).toLocaleString()}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Table Status</div>
        <div className="space-y-2">
          {data.tables.map((table) => (
            <div key={table.table} className="grid gap-2 rounded-lg border border-slate-800 p-3 text-xs md:grid-cols-5">
              <div className="font-mono text-slate-100">{table.table}</div>
              <div className="text-slate-300">Rows: {Number(table.row_count || 0).toLocaleString()}</div>
              <div className="text-slate-300">Freshness: {formatLagMinutes(table.lag_minutes)}</div>
              <div className="text-slate-500">Threshold: {table.freshness_threshold_minutes}m</div>
              <div>
                <span className={`rounded border px-2 py-0.5 ${statusClass(table.status)}`}>{table.status}</span>
              </div>
            </div>
          ))}
          {data.tables.length === 0 && <div className="text-xs text-slate-500">No table status returned.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Pipeline Status</div>
        <div className="space-y-3">
          {data.pipelines.map((pipeline) => (
            <div key={pipeline.name} className="rounded-lg border border-slate-800 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-100">{pipeline.name}</span>
                <span className={`rounded border px-2 py-0.5 ${statusClass(pipeline.status)}`}>{pipeline.status}</span>
              </div>
              <div className="grid gap-2 text-xs md:grid-cols-2">
                {pipeline.checks.map((check) => (
                  <div key={`${pipeline.name}-${check.type}`} className="rounded border border-slate-800 p-2">
                    <div className="text-slate-300">{check.type.toUpperCase()}</div>
                    <div className="text-slate-500">HTTP: {check.http_status ?? "n/a"}</div>
                    <div className="text-slate-500">Rows: {Number(check.count || 0)}</div>
                    <span className={`mt-1 inline-block rounded border px-2 py-0.5 ${statusClass(check.status)}`}>{check.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {data.pipelines.length === 0 && <div className="text-xs text-slate-500">No pipeline status returned.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Issues</div>
        <div className="space-y-2">
          {data.issues.slice(0, 50).map((issue) => (
            <div key={String(issue.key)} className="rounded border border-slate-800 p-2 text-xs text-slate-300">
              <span className={`mr-2 rounded border px-1.5 py-0.5 ${statusClass(issue.severity === "critical" ? "down" : issue.severity === "warning" ? "degraded" : "ok")}`}>
                {issue.severity}
              </span>
              {issue.message}
            </div>
          ))}
          {data.issues.length === 0 && <div className="text-xs text-emerald-300">No active issues.</div>}
        </div>
      </section>
    </div>
  );
}
