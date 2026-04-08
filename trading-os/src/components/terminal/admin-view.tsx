"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Mail,
  Play,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost } from "@/lib/api/client";
import { getDataIntegrity, type IntegrityIssue, type IntegrityPayload, type IntegrityTable } from "@/lib/api/dataIntegrity";
import { QUERY_POLICY } from "@/lib/queries/policy";

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type AdminDiagnosticsPayload = {
  ok?: boolean;
  status?: string;
  database_health?: {
    tables?: Record<string, number>;
  };
  checked_at?: string;
};

type AdminSystemPayload = {
  ok?: boolean;
  system_status?: string;
  database_tables?: number;
  engines_running?: number;
  providers_online?: number;
  engine_health?: Record<string, unknown>;
  system_alerts?: Array<Record<string, unknown>>;
  checked_at?: string;
};

type SystemHealthPayload = {
  backend?: string;
  db?: string;
  quotes?: string;
  ohlc?: string;
  error?: string;
};

type CronStatusPayload = {
  status?: string;
  recent_runs?: Array<Record<string, unknown>>;
  error?: string;
};

type CoverageSummary = {
  baseline?: {
    missingNewsCount?: number | null;
    missingEarningsCount?: number | null;
  };
  current?: {
    missingNewsCount?: number | null;
    missingEarningsCount?: number | null;
  };
  completion?: {
    newsPercent?: number | null;
    earningsPercent?: number | null;
  };
};

type CoverageCampaignPayload = {
  success?: boolean;
  generatedAt?: string;
  summary?: CoverageSummary;
  status?: Record<string, unknown> | null;
  checkpoint?: Record<string, unknown> | null;
};

type NewsletterDiagnosticsPayload = {
  scheduler?: {
    timezone?: string;
    nextMorningBriefRun?: string;
    nextNewsletterRun?: string;
  };
  summary?: {
    subscriberCount?: number;
    lastMorningBriefRun?: string | null;
    lastSendCount?: number;
    lastFailure?: {
      createdAt?: string | null;
      reason?: string;
      detail?: string | null;
    } | null;
  };
  latestRun?: {
    createdAt?: string | null;
    selectedTickers?: string[];
    mcpEnhancementStatus?: string;
  };
  sendHistory?: Array<Record<string, unknown>>;
};

type NewsletterPreviewPayload = {
  topSignals?: Array<Record<string, unknown>>;
  marketNarrative?: string;
  meta?: {
    subscriberCount?: number;
    averageOpenRate?: number;
    averageClickRate?: number;
  };
};

type UsersPayload = {
  ok?: boolean;
  users?: Array<{
    id: number;
    username: string;
    email?: string;
    is_admin?: number;
    is_active?: number;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getString(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString();
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["ok", "healthy", "running", "green", "operational"].includes(normalized)) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (["warning", "degraded", "stale", "amber", "partial"].includes(normalized)) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
  if (["down", "error", "critical", "red", "unreachable"].includes(normalized)) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  }
  return "border-slate-700 bg-slate-800/70 text-slate-300";
}

function Dot({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = ["ok", "healthy", "running", "green", "operational"].includes(normalized)
    ? "bg-emerald-400"
    : ["warning", "degraded", "stale", "amber", "partial"].includes(normalized)
      ? "bg-amber-400"
      : ["down", "error", "critical", "red", "unreachable"].includes(normalized)
        ? "bg-rose-400"
        : "bg-slate-500";

  return <span className={`inline-flex size-2 rounded-full ${tone}`} />;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-800 bg-[#0f1520] p-5 ${className}`}>{children}</section>;
}

function SectionTitle({ icon: Icon, title, detail }: { icon: React.ComponentType<{ className?: string }>; title: string; detail?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="size-4 text-slate-500" />
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {detail ? <p className="text-[11px] text-slate-500">{detail}</p> : null}
      </div>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone(label)}`}>
      <Dot status={label} />
      {label}
    </span>
  );
}

function TableStatusRow({ title, table, fallbackCount }: { title: string; table: IntegrityTable | null; fallbackCount?: number | null }) {
  const rowCount = table?.row_count ?? fallbackCount ?? null;
  const freshness = table?.latest_timestamp ? formatDateTime(table.latest_timestamp) : "—";
  const lag = table?.lag_minutes != null ? `${table.lag_minutes}m lag` : "No timestamp";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-100">{title}</p>
          <p className="mt-1 text-[11px] text-slate-500">{table?.table || "No mapped integrity table"}</p>
        </div>
        <StatusPill label={table?.status || (rowCount && rowCount > 0 ? "ok" : "warning")} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500">Rows</p>
          <p className="mt-1 font-semibold text-slate-200">{formatNumber(rowCount)}</p>
        </div>
        <div>
          <p className="text-slate-500">Freshness</p>
          <p className="mt-1 font-semibold text-slate-200">{lag}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">Last update {freshness}</p>
    </div>
  );
}

function findTable(tables: IntegrityTable[], needles: string[]) {
  return tables.find((table) => needles.some((needle) => table.table.toLowerCase().includes(needle.toLowerCase()))) || null;
}

function renderIssue(issue: IntegrityIssue, index: number) {
  return (
    <div key={`${issue.key}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-100">{issue.message}</p>
        <StatusPill label={issue.severity} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{issue.type} · {issue.key}</p>
    </div>
  );
}

function runtimeEntries(engineHealth: Record<string, unknown> | undefined) {
  return Object.entries(engineHealth || {}).filter(([, value]) => {
    const record = asRecord(value);
    return Boolean(record && ("status" in record || "rows" in record || "last_run" in record || "last_update" in record));
  });
}

export function AdminView() {
  const { isAdmin, initialized } = useAuth();
  const queryClient = useQueryClient();

  const systemHealthQuery = useQuery({
    queryKey: ["admin-live", "system-health"],
    queryFn: () => apiGet<SystemHealthPayload>("/api/system/health").catch(() => ({} as SystemHealthPayload)),
    ...QUERY_POLICY.fast,
    refetchInterval: 30_000,
  });
  const diagnosticsQuery = useQuery({
    queryKey: ["admin-live", "diagnostics"],
    queryFn: () => apiGet<AdminDiagnosticsPayload>("/api/admin/diagnostics").catch(() => ({} as AdminDiagnosticsPayload)),
    ...QUERY_POLICY.medium,
    refetchInterval: 45_000,
  });
  const systemQuery = useQuery({
    queryKey: ["admin-live", "system"],
    queryFn: () => apiGet<AdminSystemPayload>("/api/admin/system").catch(() => ({} as AdminSystemPayload)),
    ...QUERY_POLICY.medium,
    refetchInterval: 45_000,
  });
  const cronQuery = useQuery({
    queryKey: ["admin-live", "cron"],
    queryFn: () => apiGet<CronStatusPayload>("/api/system/cron-status").catch(() => ({} as CronStatusPayload)),
    ...QUERY_POLICY.fast,
    refetchInterval: 30_000,
  });
  const coverageQuery = useQuery({
    queryKey: ["admin-live", "coverage"],
    queryFn: () => apiGet<CoverageCampaignPayload>("/api/system/coverage-campaign").catch(() => ({} as CoverageCampaignPayload)),
    ...QUERY_POLICY.medium,
    refetchInterval: 30_000,
  });
  const integrityQuery = useQuery({
    queryKey: ["admin-live", "integrity"],
    queryFn: getDataIntegrity,
    ...QUERY_POLICY.medium,
    refetchInterval: 45_000,
  });
  const newsletterDiagnosticsQuery = useQuery({
    queryKey: ["admin-live", "newsletter-diagnostics"],
    queryFn: () => apiGet<ApiEnvelope<NewsletterDiagnosticsPayload>>("/api/newsletter/diagnostics").catch(() => ({ success: false })),
    ...QUERY_POLICY.medium,
    refetchInterval: 60_000,
  });
  const newsletterPreviewQuery = useQuery({
    queryKey: ["admin-live", "newsletter-preview"],
    queryFn: () => apiGet<ApiEnvelope<NewsletterPreviewPayload>>("/api/newsletter/preview").catch(() => ({ success: false })),
    ...QUERY_POLICY.medium,
    refetchInterval: 60_000,
  });
  const usersQuery = useQuery({
    queryKey: ["admin-live", "users"],
    queryFn: () => apiGet<UsersPayload>("/api/admin/users").catch(() => ({ ok: false, users: [] })),
    ...QUERY_POLICY.slow,
  });

  const testNewsletterMutation = useMutation({
    mutationFn: () => apiPost("/api/admin/email-test", { newsletterType: "beacon_morning" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-live", "newsletter-diagnostics"] });
    },
  });
  const liveNewsletterMutation = useMutation({
    mutationFn: () => apiPost("/api/newsletter/send", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-live", "newsletter-diagnostics"] });
      queryClient.invalidateQueries({ queryKey: ["admin-live", "newsletter-preview"] });
    },
  });

  if (!initialized) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-800/50" />)}</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-rose-800/40 bg-rose-950/10 py-16 text-center">
        <Shield className="mb-3 size-10 text-rose-400/50" />
        <p className="text-sm font-semibold text-rose-300">Admin Access Required</p>
        <p className="mt-1 text-xs text-slate-600">This console is restricted to admin users only.</p>
      </div>
    );
  }

  const integrity = integrityQuery.data as IntegrityPayload | undefined;
  const tables = integrity?.tables || [];
  const issues = integrity?.issues || [];
  const diagnosticTables = diagnosticsQuery.data?.database_health?.tables || {};
  const newsletterDiagnostics = (newsletterDiagnosticsQuery.data as ApiEnvelope<NewsletterDiagnosticsPayload> | undefined)?.data;
  const newsletterPreview = (newsletterPreviewQuery.data as ApiEnvelope<NewsletterPreviewPayload> | undefined)?.data;
  const users = usersQuery.data?.users || [];
  const recentCronRuns = cronQuery.data?.recent_runs || [];
  const recentAlerts = (systemQuery.data?.system_alerts || []).slice(0, 6);
  const engineRows = runtimeEntries(systemQuery.data?.engine_health);
  const activeUsers = users.filter((user) => Number(user.is_active) === 1).length;
  const adminUsers = users.filter((user) => Number(user.is_admin) === 1).length;

  const coverageSummary = coverageQuery.data?.summary;
  const coverageStatus = asRecord(coverageQuery.data?.status);
  const checkpoint = asRecord(coverageQuery.data?.checkpoint);
  const checkpointSupervisor = asRecord(checkpoint?.supervisor);

  const platformStatus = integrity?.status || systemQuery.data?.system_status || systemHealthQuery.data?.backend || "unknown";
  const providerCount = systemQuery.data?.providers_online ?? 0;
  const subscriberCount = newsletterDiagnostics?.summary?.subscriberCount ?? newsletterPreview?.meta?.subscriberCount ?? 0;

  return (
    <div className="space-y-5">
      <Card className="bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_30%),#0f1520]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-sky-300/80">Operations Console</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-100">Live admin feed for platform health, coverage, and newsletter delivery</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              This view is wired to the live health, integrity, cron, coverage, and newsletter endpoints that still exist in the backend. It is intended to surface broken data paths instead of hiding them behind empty tabs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/coverage-campaign" className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800">Coverage Campaign</Link>
            <Link href="/admin/cron-debug" className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800">Cron Debug</Link>
            <Link href="/admin/data-health" className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800">Data Health</Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Platform Status</p>
            <div className="mt-3 flex items-center gap-2">
              <StatusPill label={platformStatus} />
            </div>
            <p className="mt-3 text-xs text-slate-500">Checked {formatDateTime(integrity?.checked_at || systemQuery.data?.checked_at || diagnosticsQuery.data?.checked_at)}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Providers Online</p>
            <p className="mt-3 text-3xl font-semibold text-slate-100">{formatNumber(providerCount)}</p>
            <p className="mt-2 text-xs text-slate-500">DB {getString(systemHealthQuery.data?.db)} · Quotes {getString(systemHealthQuery.data?.quotes)} · OHLC {getString(systemHealthQuery.data?.ohlc)}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Integrity Issues</p>
            <p className="mt-3 text-3xl font-semibold text-slate-100">{formatNumber(issues.length)}</p>
            <p className="mt-2 text-xs text-slate-500">{integrity?.parity?.status ? `Frontend parity ${integrity.parity.status}` : "Parity not reported"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Newsletter Reach</p>
            <p className="mt-3 text-3xl font-semibold text-slate-100">{formatNumber(subscriberCount)}</p>
            <p className="mt-2 text-xs text-slate-500">Next run {newsletterDiagnostics?.scheduler?.nextNewsletterRun || "—"}</p>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={Database} title="Site Data Health" detail="Authoritative table health for OHLC, technicals, news, earnings, and opportunity output." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <TableStatusRow title="OHLC / Quotes" table={findTable(tables, ["intraday", "ohlc", "market_quotes"])} fallbackCount={getNumber(diagnosticTables.intraday_1m)} />
          <TableStatusRow title="Technical Data" table={findTable(tables, ["market_metrics", "technical"])} fallbackCount={getNumber(diagnosticTables.trade_setups)} />
          <TableStatusRow title="News" table={findTable(tables, ["news_articles", "news"])} fallbackCount={getNumber(diagnosticTables.news_articles)} />
          <TableStatusRow title="Earnings" table={findTable(tables, ["earnings_events", "earnings"])} fallbackCount={getNumber(diagnosticTables.earnings_events)} />
          <TableStatusRow title="Opportunities" table={findTable(tables, ["opportunity_stream", "trade_signals", "stocks_in_play"])} fallbackCount={getNumber(diagnosticTables.opportunity_stream)} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <SectionTitle icon={Server} title="System and Engines" detail="Scheduler, engine runtime, providers, and recent alert state." />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs font-semibold text-slate-100">Health snapshot</p>
              <div className="mt-3 space-y-2 text-xs text-slate-300">
                <div className="flex items-center justify-between"><span className="text-slate-500">Backend</span><StatusPill label={getString(systemHealthQuery.data?.backend, "unknown")} /></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Database</span><StatusPill label={getString(systemHealthQuery.data?.db, "unknown")} /></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Engines running</span><span>{formatNumber(systemQuery.data?.engines_running ?? null)}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Admin users</span><span>{formatNumber(adminUsers)}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Active users</span><span>{formatNumber(activeUsers)}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs font-semibold text-slate-100">Coverage campaign</p>
              <div className="mt-3 space-y-2 text-xs text-slate-300">
                <div className="flex items-center justify-between"><span className="text-slate-500">Current missing news</span><span>{formatNumber(coverageSummary?.current?.missingNewsCount ?? getNumber(coverageStatus?.missing_news_count))}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Current missing earnings</span><span>{formatNumber(coverageSummary?.current?.missingEarningsCount ?? getNumber(coverageStatus?.missing_earnings_count))}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">News completion</span><span>{formatPercent(coverageSummary?.completion?.newsPercent ?? null)}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">No-progress cycles</span><span>{formatNumber(getNumber(checkpointSupervisor?.no_progress_cycles) ?? getNumber(coverageStatus?.no_progress_cycles))}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Last heartbeat</span><span>{formatDateTime(coverageQuery.data?.generatedAt || getString(checkpoint?.updated_at, ""))}</span></div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="mb-3 text-xs font-semibold text-slate-100">Engine runtime</p>
            {engineRows.length > 0 ? (
              <div className="space-y-2">
                {engineRows.slice(0, 8).map(([name, value]) => {
                  const record = asRecord(value);
                  const status = getString(record?.status, "unknown");
                  return (
                    <div key={name} className="flex items-center justify-between rounded-lg border border-slate-800/60 px-3 py-2 text-xs">
                      <div>
                        <p className="font-medium text-slate-200">{name.replace(/_/g, " ")}</p>
                        <p className="text-[11px] text-slate-500">Last update {formatDateTime(getString(record?.last_update || record?.last_run, ""))}</p>
                      </div>
                      <StatusPill label={status} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No engine telemetry returned from the backend.</p>
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle icon={Clock3} title="Scheduler and Recent Events" detail="Cron activity and latest operational alerts." />
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-100">Cron status</p>
                <StatusPill label={getString(cronQuery.data?.status, cronQuery.data?.error ? "error" : "unknown")} />
              </div>
              <div className="mt-3 space-y-2">
                {recentCronRuns.slice(-6).reverse().map((entry, index) => (
                  <div key={index} className="rounded-lg border border-slate-800/60 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-200">{getString(entry.event, "event")}</span>
                      <span className="text-slate-500">{formatDateTime(typeof entry.timestamp === "string" ? entry.timestamp : null)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{JSON.stringify(entry.payload || {})}</p>
                  </div>
                ))}
                {recentCronRuns.length === 0 ? <p className="text-xs text-slate-500">No recent cron events recorded.</p> : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="mb-3 text-xs font-semibold text-slate-100">Recent alerts</p>
              <div className="space-y-2">
                {recentAlerts.length > 0 ? recentAlerts.map((alert, index) => (
                  <div key={index} className="rounded-lg border border-slate-800/60 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-200">{getString(alert.message, "Alert")}</span>
                      <StatusPill label={getString(alert.severity, "unknown")} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{getString(alert.source, "system")} · {formatDateTime(typeof alert.created_at === "string" ? alert.created_at : null)}</p>
                  </div>
                )) : <p className="text-xs text-slate-500">No recent system alerts returned.</p>}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <SectionTitle icon={Mail} title="Newsletter System" detail="Diagnostics, preview, recent send history, and manual recovery controls." />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Subscribers</p>
              <p className="mt-2 text-2xl font-semibold text-slate-100">{formatNumber(subscriberCount)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Last brief {formatDateTime(newsletterDiagnostics?.summary?.lastMorningBriefRun || null)}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Next scheduled run</p>
              <p className="mt-2 text-sm font-semibold text-slate-100">{newsletterDiagnostics?.scheduler?.nextNewsletterRun || "—"}</p>
              <p className="mt-1 text-[11px] text-slate-500">Timezone {newsletterDiagnostics?.scheduler?.timezone || "—"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Preview quality</p>
              <p className="mt-2 text-sm font-semibold text-slate-100">Open {formatPercent(newsletterPreview?.meta?.averageOpenRate ?? null, 2)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Click {formatPercent(newsletterPreview?.meta?.averageClickRate ?? null, 2)}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => testNewsletterMutation.mutate()}
              disabled={testNewsletterMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
            >
              <Play className={`size-3 ${testNewsletterMutation.isPending ? "animate-spin" : ""}`} />
              Send test morning brief
            </button>
            <button
              onClick={() => liveNewsletterMutation.mutate()}
              disabled={liveNewsletterMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 transition hover:bg-emerald-500/15 disabled:opacity-50"
            >
              <Mail className={`size-3 ${liveNewsletterMutation.isPending ? "animate-spin" : ""}`} />
              Run live newsletter send
            </button>
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["admin-live", "newsletter-diagnostics"] });
                queryClient.invalidateQueries({ queryKey: ["admin-live", "newsletter-preview"] });
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:bg-slate-800"
            >
              <RefreshCw className="size-3" />
              Refresh diagnostics
            </button>
          </div>

          {(testNewsletterMutation.isError || liveNewsletterMutation.isError || newsletterDiagnostics?.summary?.lastFailure) ? (
            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-100">
              {newsletterDiagnostics?.summary?.lastFailure
                ? `${newsletterDiagnostics.summary.lastFailure.reason || "newsletter failure"}${newsletterDiagnostics.summary.lastFailure.detail ? ` · ${newsletterDiagnostics.summary.lastFailure.detail}` : ""}`
                : "One of the newsletter actions returned an error. Check server logs for the full provider response."}
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.95fr]">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="mb-3 text-xs font-semibold text-slate-100">Preview payload</p>
              <p className="text-xs text-slate-400">{newsletterPreview?.marketNarrative || "No market narrative returned for preview."}</p>
              <div className="mt-4 space-y-2">
                {(newsletterPreview?.topSignals || []).slice(0, 5).map((signal: Record<string, unknown>, index: number) => (
                  <div key={`${getString(signal.symbol, "symbol")}-${index}`} className="rounded-lg border border-slate-800/60 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-200">{getString(signal.symbol)}</span>
                      <span className="text-slate-500">{getString(signal.strategy, "strategy")}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{getString(signal.catalyst, "No catalyst")} · {getString(signal.sector, "Unknown sector")}</p>
                  </div>
                ))}
                {(!newsletterPreview?.topSignals || newsletterPreview.topSignals.length === 0) ? <p className="text-xs text-slate-500">Preview did not return top signals.</p> : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="mb-3 text-xs font-semibold text-slate-100">Recent send history</p>
              <div className="space-y-2">
                {(newsletterDiagnostics?.sendHistory || []).slice(0, 6).map((row: Record<string, unknown>, index: number) => (
                  <div key={index} className="rounded-lg border border-slate-800/60 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-200">{getString(row.campaign_type, "newsletter")}</span>
                      <StatusPill label={getString(row.status, "unknown")} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(typeof row.sent_at === "string" ? row.sent_at : null)} · recipients {formatNumber(getNumber(row.recipients_count))}</p>
                  </div>
                ))}
                {(!newsletterDiagnostics?.sendHistory || newsletterDiagnostics.sendHistory.length === 0) ? <p className="text-xs text-slate-500">No newsletter send history returned.</p> : null}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={AlertTriangle} title="Integrity Feed" detail="Problems the admin page should surface instead of silently masking." />
          <div className="space-y-3">
            {issues.length > 0 ? issues.slice(0, 8).map(renderIssue) : (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <CheckCircle2 className="mr-2 inline size-4" />
                No active integrity issues were returned by the live data-integrity endpoint.
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="mb-3 text-xs font-semibold text-slate-100">Latest newsletter selection</p>
            <div className="flex flex-wrap gap-2">
              {(newsletterDiagnostics?.latestRun?.selectedTickers || []).map((symbol: string) => (
                <span key={symbol} className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200">{symbol}</span>
              ))}
              {(!newsletterDiagnostics?.latestRun?.selectedTickers || newsletterDiagnostics.latestRun.selectedTickers.length === 0) ? <span className="text-xs text-slate-500">No selected tickers reported.</span> : null}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Enhancement source {newsletterDiagnostics?.latestRun?.mcpEnhancementStatus || "—"}</p>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="mb-3 text-xs font-semibold text-slate-100">Operator notes</p>
            <div className="space-y-2 text-xs text-slate-400">
              <p className="flex items-start gap-2"><Sparkles className="mt-0.5 size-3 text-sky-400" />This page is intentionally wired to live routes only. If a section is empty now, that is a backend data problem, not a fake placeholder state.</p>
              <p className="flex items-start gap-2"><Wrench className="mt-0.5 size-3 text-amber-400" />Coverage and cron remain linked to their dedicated pages so you can drill into repair loops and scheduler output without leaving admin.</p>
              <p className="flex items-start gap-2"><Users className="mt-0.5 size-3 text-emerald-400" />User inventory is still live through the existing admin users endpoint: {formatNumber(users.length)} total accounts, {formatNumber(adminUsers)} admins.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
