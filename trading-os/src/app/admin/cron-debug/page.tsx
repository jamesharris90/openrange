"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CronLog = {
  event?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
};

type CronStatusResponse = {
  status?: string;
  recent_runs?: CronLog[];
  error?: string;
};

export default function CronDebugPage() {
  const [logs, setLogs] = useState<CronLog[]>([]);
  const [statusText, setStatusText] = useState<string>("Loading cron status...");
  const [running, setRunning] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch("/api/system/cron-status", { cache: "no-store" });
      const payload = (await response.json()) as CronStatusResponse;

      if (!response.ok) {
        setStatusText(payload.error || "Failed to load cron status");
        return;
      }

      const nextLogs = Array.isArray(payload.recent_runs) ? payload.recent_runs : [];
      setLogs(nextLogs);
      setStatusText(`Live: ${nextLogs.length} recent cron events`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to load cron status");
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5_000);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  const hasRecentFailures = useMemo(
    () => logs.slice(-10).some((entry) => entry.event === "ENGINE_ERROR"),
    [logs]
  );

  return (
    <div className="min-h-screen bg-[#0B0F14] p-6 text-white">
      <h1 className="mb-4 text-xl font-bold">CRON STATUS</h1>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={async () => {
            setRunning(true);
            setStatusText("Running all cron engines...");
            try {
              const response = await fetch("/api/cron/run-all", { method: "POST" });
              const payload = (await response.json().catch(() => ({}))) as { error?: string };
              if (!response.ok) {
                setStatusText(payload.error || "Cron trigger failed");
              } else {
                setStatusText("Manual cron run complete. Refreshing logs...");
              }
            } catch (error) {
              setStatusText(error instanceof Error ? error.message : "Cron trigger failed");
            } finally {
              await fetchLogs();
              setRunning(false);
            }
          }}
          disabled={running}
          className="rounded-xl bg-green-500 px-4 py-2 text-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          RUN CRON NOW
        </button>
        <p className="text-xs text-gray-300">{statusText}</p>
        <p className={`text-xs ${hasRecentFailures ? "text-red-400" : "text-green-400"}`}>
          {hasRecentFailures ? "Recent failures detected" : "No recent failures detected"}
        </p>
      </div>

      <div className="space-y-2">
        {logs.map((log, i) => (
          <div key={`${log.timestamp || "unknown"}-${i}`} className="rounded-xl border border-[#1F2937] bg-[#121826] p-3">
            <p className="text-xs text-gray-400">{log.timestamp || "unknown timestamp"}</p>
            <p className="text-sm">{log.event || "unknown event"}</p>
            <p className="text-xs text-green-400">{JSON.stringify(log.payload || {})}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
