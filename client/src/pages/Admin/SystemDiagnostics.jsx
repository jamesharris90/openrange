import React, { useEffect, useState } from "react";
import { fetchSafe } from '../../api/fetchSafe';
import { authFetch } from '../../utils/api';

function Badge({ status }) {
  const normalized = String(status || "unknown").toUpperCase();
  const classes = normalized === "OK"
    ? "bg-emerald-500/20 text-emerald-300"
    : normalized === "PARTIAL"
      ? "bg-amber-500/20 text-amber-300"
      : "bg-rose-500/20 text-rose-300";

  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${classes}`}>{normalized}</span>;
}

export default function SystemDiagnostics() {
  const [report, setReport] = useState(null);
  const [engineHealth, setEngineHealth] = useState([]);
  const [newsletterDiagnostics, setNewsletterDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError("");
      try {
        const [reportJson, engineJson, newsletterJson] = await Promise.all([
          fetchSafe('/api/system-audit/report', {
            headers: { Accept: 'application/json' },
            credentials: 'include',
            fallback: {},
          }),
          fetchSafe('/api/system/engine-health', {
            headers: { Accept: 'application/json' },
            credentials: 'include',
            fallback: { data: { engines: [] } },
          }),
          (async () => {
            try {
              const response = await authFetch('/api/newsletter/diagnostics');
              if (!response?.ok) return null;
              const payload = await response.json();
              return payload?.success ? payload.data : null;
            } catch (_error) {
              return null;
            }
          })(),
        ]);
        if (cancelled) return;

        setReport(reportJson && typeof reportJson === 'object' ? reportJson : null);
        setEngineHealth(Array.isArray(engineJson?.data?.engines) ? engineJson.data.engines : []);
        setNewsletterDiagnostics(newsletterJson && typeof newsletterJson === 'object' ? newsletterJson : null);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load system audit report');
          setReport(null);
          setEngineHealth([]);
          setNewsletterDiagnostics(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, []);

  const endpoints = Array.isArray(report?.endpoints) ? report.endpoints : [];
  const pages = Array.isArray(report?.pages) ? report.pages : [];
  const quality = report?.dataQuality && typeof report.dataQuality === 'object' ? report.dataQuality : {};

  const normalizeEngineStatus = (status, lagSeconds) => {
    const raw = String(status || 'unknown').toLowerCase();
    if (raw === 'healthy') return 'Healthy';
    if (raw === 'delayed') return 'Delayed';
    if (raw === 'stalled') return 'Stalled';
    if (raw === 'error') return 'Error';
    if (raw === 'running') return 'Healthy';
    if (raw === 'no output') return 'Error';
    if (Number.isFinite(lagSeconds) && lagSeconds > 0) return 'Delayed';
    return 'Unknown';
  };

  const engineStatusClass = (statusLabel) => {
    if (statusLabel === 'Healthy') return 'bg-emerald-500/20 text-emerald-300';
    if (statusLabel === 'Delayed') return 'bg-amber-500/20 text-amber-300';
    return 'bg-rose-500/20 text-rose-300';
  };

  return (
    <div className="space-y-6 p-10 text-slate-100">
      <div>
        <h1 className="text-3xl font-bold">System Diagnostics</h1>
        <p className="mt-2 text-slate-400">Endpoint health, data completeness, and page readiness.</p>
        {report?.generatedAt ? <p className="mt-1 text-xs text-slate-500">Generated: {report.generatedAt}</p> : null}
      </div>

      {loading ? <div className="rounded border border-slate-800 bg-slate-900 p-4 text-sm">Loading report...</div> : null}
      {!loading && error ? <div className="rounded border border-rose-500/40 bg-rose-500/10 p-4 text-sm">{error}</div> : null}

      {!loading && !error ? (
        <>
          <section className="rounded border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Endpoint Health</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-2 py-2">Endpoint</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Length</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((row) => (
                    <tr key={row.endpoint} className="border-t border-slate-800">
                      <td className="px-2 py-2">{row.endpoint}</td>
                      <td className="px-2 py-2"><Badge status={row.ok ? 'OK' : 'FAIL'} /></td>
                      <td className="px-2 py-2 text-slate-300">{row.responseType || 'unknown'}</td>
                      <td className="px-2 py-2 text-slate-300">{row.arrayLength ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Page Readiness</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {pages.map((row) => (
                <div key={row.page} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2">
                  <span>{row.page}</span>
                  <Badge status={row.status} />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Data Completeness</h2>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Rows missing symbol: {quality.rowsMissingSymbol ?? 0}</div>
              <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Rows missing timestamp: {quality.rowsMissingTimestamp ?? 0}</div>
              <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Symbols missing catalysts: {quality.symbolsMissingCatalyst ?? 0}</div>
              <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Expected move zero rows: {quality.expectedMoveZeroRows ?? 0}</div>
            </div>
          </section>

          <section className="rounded border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Engine Health</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-2 py-2">Engine</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Last Run</th>
                    <th className="px-2 py-2">Lag</th>
                  </tr>
                </thead>
                <tbody>
                  {engineHealth.map((engine) => {
                    const statusLabel = normalizeEngineStatus(engine?.status, engine?.lagSeconds);
                    const lastRunText = engine?.lastRun
                      ? new Date(engine.lastRun).toLocaleString()
                      : 'Never';
                    return (
                      <tr key={engine?.key || engine?.name} className="border-t border-slate-800">
                        <td className="px-2 py-2">{engine?.name || 'Unknown'}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${engineStatusClass(statusLabel)}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-300">{lastRunText}</td>
                        <td className="px-2 py-2 text-slate-300">{Number.isFinite(engine?.lagSeconds) ? `${engine.lagSeconds}s` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Newsletter / Email Pipeline</h2>
            {!newsletterDiagnostics ? (
              <div className="text-sm text-slate-400">Diagnostics unavailable or unauthorized.</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Scheduler timezone: {newsletterDiagnostics?.scheduler?.timezone || 'N/A'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Weekday only: {newsletterDiagnostics?.scheduler?.weekdayOnly ? 'Yes' : 'No'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Next morning brief run: {newsletterDiagnostics?.scheduler?.nextMorningBriefRun || 'N/A'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Next newsletter run: {newsletterDiagnostics?.scheduler?.nextNewsletterRun || 'N/A'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Last morning brief run: {newsletterDiagnostics?.summary?.lastMorningBriefRun ? new Date(newsletterDiagnostics.summary.lastMorningBriefRun).toLocaleString() : 'Never'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Last send count: {newsletterDiagnostics?.summary?.lastSendCount ?? 0}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">Subscriber count: {newsletterDiagnostics?.summary?.subscriberCount ?? 0}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">MCP enhancement: {newsletterDiagnostics?.latestRun?.mcpEnhancementStatus || 'unknown'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2 md:col-span-2">Top tickers: {(newsletterDiagnostics?.latestRun?.selectedTickers || []).join(', ') || 'None'}</div>
                <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2 md:col-span-2">Last failure: {newsletterDiagnostics?.summary?.lastFailure?.reason || 'None'}</div>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
