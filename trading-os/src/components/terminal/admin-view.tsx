"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw,
  Users, Mail, Database, Activity, Shield, FileText,
  Zap, TrendingUp, ChevronDown, ChevronUp, Play,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost } from "@/lib/api/client";
import { QUERY_POLICY } from "@/lib/queries/policy";

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthPayload   = { status?: string; scheduler_status?: string; uptime_seconds?: number; error?: string };
type LearningPayload = { ok?: boolean; evaluation_rate_pct?: number; stuck_signals?: number; error_count_last_24h?: number; status?: string; signals_logged_last_24h?: number; signals_evaluated_last_24h?: number };
type PipelineTable   = { table: string; row_count: number; last_updated: string | null; age_minutes: number | null; status: 'green' | 'amber' | 'red' | 'unknown'; error?: string };
type PipelinePayload = { ok?: boolean; tables?: PipelineTable[] };
type SignalPerfPayload = { ok?: boolean; summary?: { total_signals: number; wins: number; win_rate: number | null; avg_return: number | null }; data?: Array<{ date?: string; total_signals?: number; wins?: number; losses?: number; win_rate?: number; avg_return?: number }> };
type SimSetup        = { setup: string; win_rate: number; total: number };
type SimLivePayload  = { ok?: boolean; active_count?: number; simulated_pnl_today?: number; win_rate_today?: number | null; win_rate_7d?: number | null; total_evaluated_today?: number; best_setup?: SimSetup | null; worst_setup?: SimSetup | null; all_setups?: SimSetup[]; active_trades?: Array<{ id: number; symbol: string; setup_type?: string; entry_price?: number; execution_rating?: string; timestamp: string }> };
type SignalFlowPayload = { ok?: boolean; last_5m?: number; last_1h?: number; last_24h?: number; evaluated_24h?: number; unevaluated_24h?: number; stuck_signals?: number };
type UserRow         = { id: number; username: string; email?: string; is_admin: number; is_active: number; last_login?: string; created_at?: string };
type UsersPayload    = { ok?: boolean; users?: UserRow[]; count?: number };
type NewsletterStats = { ok?: boolean; total_subscribers?: number; active_subscribers?: number; emails_received_24h?: number };
type SubscriberRow   = { email: string; is_active?: boolean; timezone?: string; created_at?: string };
type SubscribersPayload = { ok?: boolean; subscribers?: SubscriberRow[]; count?: number };
type IntegrityCheck  = { issue: string; count: number; severity: 'OK' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' };
type IntegrityPayload = { ok?: boolean; checks?: IntegrityCheck[]; issues?: IntegrityCheck[]; issue_count?: number };
type EngineRow       = { name: string; status: 'running' | 'stale' | 'unknown'; last_run: string | null; age_minutes: number | null };
type EnginesPayload  = { ok?: boolean; engines?: EngineRow[] };
type LogEntry        = { source?: string; level?: string; message?: string; label?: string; created_at?: string };
type LogsPayload     = { ok?: boolean; logs?: LogEntry[]; count?: number; filter?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Dot({ color }: { color: 'green' | 'amber' | 'red' | 'unknown' | string }) {
  const cls = color === 'green' ? 'bg-emerald-400' : color === 'amber' ? 'bg-amber-400' : color === 'red' ? 'bg-rose-400' : 'bg-slate-500';
  return <span className={`inline-block size-2 rounded-full ${cls}`} />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ok' || status === 'healthy' || status === 'running' || status === 'green')
    return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">GREEN</span>;
  if (status === 'degraded' || status === 'stale' || status === 'amber')
    return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">AMBER</span>;
  if (status === 'critical' || status === 'down' || status === 'error' || status === 'red')
    return <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">RED</span>;
  return <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">UNKNOWN</span>;
}

function SectionHeader({ icon: Icon, title, badge }: { icon: React.ComponentType<{ className?: string }>; title: string; badge?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-slate-500" />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</h2>
      {badge}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-[#0f1520] p-4 ${className}`}>{children}</div>;
}

function StatRow({ label, value, valueClass = "text-slate-200" }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800/50 px-3 py-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={valueClass}>{value ?? "—"}</span>
    </div>
  );
}

function ageLabel(ageMins: number | null): string {
  if (ageMins === null) return "—";
  if (ageMins < 60)   return `${ageMins}m ago`;
  if (ageMins < 1440) return `${Math.round(ageMins / 60)}h ago`;
  return `${Math.round(ageMins / 1440)}d ago`;
}

function wrClass(wr: number | null): string {
  if (wr === null) return "text-slate-500";
  if (wr >= 55) return "text-emerald-400";
  if (wr >= 40) return "text-amber-400";
  return "text-rose-400";
}

function logLevelClass(level = ""): string {
  const l = level.toUpperCase();
  if (l === "CRITICAL" || l === "ERROR") return "text-rose-400";
  if (l === "WARN")  return "text-amber-400";
  return "text-slate-400";
}

const TABS = ["Health", "Pipeline", "Signals", "Simulation", "Signal Flow", "Users", "Newsletter", "Integrity", "Engines", "Logs"] as const;
type Tab = typeof TABS[number];

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function HealthPanel() {
  const healthQuery    = useQuery({ queryKey: ["admin", "health"], queryFn: () => apiGet<HealthPayload>("/api/system/health").catch(() => ({} as HealthPayload)), ...QUERY_POLICY.fast, refetchInterval: 30_000 });
  const learningQuery  = useQuery({ queryKey: ["admin", "learning"], queryFn: () => apiGet<LearningPayload>("/api/system/learning-status").catch(() => ({} as LearningPayload)), ...QUERY_POLICY.medium, refetchInterval: 60_000 });

  const h = healthQuery.data ?? {};
  const l = learningQuery.data ?? {};
  const overallStatus = l.status === 'critical' ? 'red' : h.status === 'ok' ? 'green' : h.status === 'degraded' ? 'amber' : 'unknown';

  return (
    <Card>
      <SectionHeader icon={Shield} title="System Health" badge={<StatusBadge status={overallStatus === 'green' ? 'ok' : overallStatus === 'red' ? 'error' : overallStatus} />} />
      <div className="space-y-1.5">
        <StatRow label="System Status"    value={<StatusBadge status={h.status ?? 'unknown'} />} />
        <StatRow label="Scheduler"        value={h.scheduler_status ?? "—"} valueClass={h.scheduler_status === 'running' ? 'text-emerald-400' : 'text-slate-400'} />
        <StatRow label="Uptime"           value={h.uptime_seconds != null ? `${Math.floor(h.uptime_seconds / 3600)}h ${Math.floor((h.uptime_seconds % 3600) / 60)}m` : "—"} />
        <div className="mt-2 mb-1 border-t border-slate-800/50" />
        <StatRow label="Evaluation Rate"  value={l.evaluation_rate_pct != null ? `${l.evaluation_rate_pct}%` : "—"} valueClass={l.evaluation_rate_pct != null && l.evaluation_rate_pct >= 95 ? 'text-emerald-400' : l.evaluation_rate_pct != null && l.evaluation_rate_pct >= 80 ? 'text-amber-400' : 'text-rose-400'} />
        <StatRow label="Stuck Signals"    value={l.stuck_signals ?? 0}    valueClass={(l.stuck_signals ?? 0) > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'} />
        <StatRow label="Errors (24h)"     value={l.error_count_last_24h ?? 0} valueClass={(l.error_count_last_24h ?? 0) > 0 ? 'text-amber-400' : 'text-slate-400'} />
        <StatRow label="Signals Logged"   value={l.signals_logged_last_24h ?? 0} />
        <StatRow label="Signals Evaluated" value={l.signals_evaluated_last_24h ?? 0} />
      </div>
      {(l.stuck_signals ?? 0) > 0 && (
        <div className="mt-3 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="mr-1.5 inline size-3" />
          {l.stuck_signals} signal{l.stuck_signals === 1 ? "" : "s"} stuck unevaluated — evaluation engine may be degraded
        </div>
      )}
    </Card>
  );
}

function PipelinePanel() {
  const qc = useQueryClient();
  const pipelineQuery = useQuery({ queryKey: ["admin", "pipeline"], queryFn: () => apiGet<PipelinePayload>("/api/admin/pipeline-stats").catch(() => ({} as PipelinePayload)), ...QUERY_POLICY.medium, refetchInterval: 60_000 });
  const refreshMut = useMutation({
    mutationFn: () => apiPost("/api/admin/pipeline-refresh", {}),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["admin", "pipeline"] }), 3000),
  });

  const tables = pipelineQuery.data?.tables ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <SectionHeader icon={Database} title="Data Pipeline" />
        <button
          onClick={() => refreshMut.mutate()}
          disabled={refreshMut.isPending}
          className="flex items-center gap-1.5 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${refreshMut.isPending ? 'animate-spin' : ''}`} />
          Force Refresh
        </button>
      </div>
      {tables.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-600">
              <th className="pb-1.5 text-left">Table</th>
              <th className="pb-1.5 text-right">Rows</th>
              <th className="pb-1.5 text-right">Last Updated</th>
              <th className="pb-1.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {tables.map(t => (
              <tr key={t.table}>
                <td className="py-1.5 font-mono text-slate-300">{t.table}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-400">{t.row_count.toLocaleString()}</td>
                <td className="py-1.5 text-right text-slate-500">{ageLabel(t.age_minutes)}</td>
                <td className="py-1.5 text-center"><Dot color={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : pipelineQuery.isLoading ? (
        <div className="space-y-1.5">{[...Array(5)].map((_, i) => <div key={i} className="h-7 animate-pulse rounded bg-slate-800/50" />)}</div>
      ) : (
        <p className="text-xs text-slate-600">Pipeline stats unavailable — endpoint may require admin key</p>
      )}
      {refreshMut.isSuccess && <p className="mt-2 text-[10px] text-emerald-400">Refresh triggered — data will update in ~30s</p>}
    </Card>
  );
}

function SignalsPanel() {
  const perfQuery = useQuery({ queryKey: ["admin", "signals-perf"], queryFn: () => apiGet<SignalPerfPayload>("/api/signals/performance?days=7").catch(() => ({} as SignalPerfPayload)), ...QUERY_POLICY.slow, refetchInterval: 120_000 });
  const simQuery  = useQuery({ queryKey: ["admin", "sim-signals"], queryFn: () => apiGet<SimLivePayload>("/api/simulation/live").catch(() => ({} as SimLivePayload)), ...QUERY_POLICY.slow });

  const sum = perfQuery.data?.summary;
  const rows = perfQuery.data?.data ?? [];
  const sim = simQuery.data;

  return (
    <Card>
      <SectionHeader icon={TrendingUp} title="Signal Performance" />
      {sum ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Win Rate (7d)",  value: sum.win_rate != null ? `${sum.win_rate}%` : "—",     cls: wrClass(sum.win_rate) },
            { label: "Win Rate Today", value: sim?.win_rate_today != null ? `${sim.win_rate_today}%` : "—", cls: wrClass(sim?.win_rate_today ?? null) },
            { label: "Total Signals",  value: sum.total_signals,                                    cls: "text-slate-200" },
            { label: "Avg Return",     value: sum.avg_return != null ? `${sum.avg_return > 0 ? "+" : ""}${sum.avg_return}%` : "—", cls: (sum.avg_return ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-slate-800/50 px-3 py-2">
              <div className="text-[10px] text-slate-600">{s.label}</div>
              <div className={`mt-0.5 text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-600">
              <th className="pb-1.5 text-left">Date</th>
              <th className="pb-1.5 text-right">Win Rate</th>
              <th className="pb-1.5 text-right">Signals</th>
              <th className="pb-1.5 text-right">Avg Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {rows.slice(0, 10).map((r, i) => (
              <tr key={`${r.date}-${i}`}>
                <td className="py-1 text-slate-400">{r.date?.slice(0, 10) ?? "—"}</td>
                <td className={`py-1 text-right tabular-nums ${wrClass(r.win_rate ?? null)}`}>{r.win_rate != null ? `${r.win_rate}%` : "—"}</td>
                <td className="py-1 text-right tabular-nums text-slate-400">{r.total_signals ?? 0}</td>
                <td className={`py-1 text-right tabular-nums ${(r.avg_return ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.avg_return != null ? `${r.avg_return > 0 ? "+" : ""}${r.avg_return}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !perfQuery.isLoading ? (
        <p className="text-xs text-slate-600">Signal performance data appears once signal_performance_daily is populated. Evaluation runs every 5 min.</p>
      ) : (
        <div className="space-y-1.5">{[...Array(5)].map((_, i) => <div key={i} className="h-7 animate-pulse rounded bg-slate-800/50" />)}</div>
      )}

      {/* Setup breakdown from sim */}
      {(sim?.all_setups?.length ?? 0) > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-600">By Setup Type (7d)</div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-800 text-[10px] uppercase text-slate-600"><th className="pb-1 text-left">Setup</th><th className="pb-1 text-right">Win Rate</th><th className="pb-1 text-right">Signals</th></tr></thead>
            <tbody className="divide-y divide-slate-800/50">
              {sim!.all_setups!.map((s, i) => (
                <tr key={`${s.setup}-${i}`}>
                  <td className="py-1 text-slate-300">{s.setup}</td>
                  <td className={`py-1 text-right tabular-nums ${wrClass(s.win_rate)}`}>{s.win_rate}%</td>
                  <td className="py-1 text-right tabular-nums text-slate-500">{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function SimulationPanel() {
  const [showTrades, setShowTrades] = useState(false);
  const simQuery = useQuery({ queryKey: ["admin", "sim-live"], queryFn: () => apiGet<SimLivePayload>("/api/simulation/live").catch(() => ({} as SimLivePayload)), ...QUERY_POLICY.medium, refetchInterval: 60_000 });

  const sim = simQuery.data ?? {};

  return (
    <Card>
      <SectionHeader icon={Activity} title="Live Simulation Monitor" />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <StatRow label="Active Trades"     value={sim.active_count ?? 0} />
        <StatRow label="Evaluated Today"   value={sim.total_evaluated_today ?? 0} />
        <StatRow label="Win Rate Today"    value={sim.win_rate_today != null ? `${sim.win_rate_today}%` : "—"} valueClass={wrClass(sim.win_rate_today ?? null)} />
        <StatRow label="Win Rate 7d"       value={sim.win_rate_7d != null ? `${sim.win_rate_7d}%` : "—"} valueClass={wrClass(sim.win_rate_7d ?? null)} />
        <StatRow label="Simulated PnL"     value={sim.simulated_pnl_today != null ? `${sim.simulated_pnl_today > 0 ? "+" : ""}${sim.simulated_pnl_today.toFixed(2)}%` : "—"} valueClass={(sim.simulated_pnl_today ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
        <StatRow label="Best Setup Today"  value={sim.best_setup?.setup ?? "—"} valueClass="text-emerald-400" />
      </div>
      {sim.worst_setup && (
        <StatRow label="Worst Setup Today" value={`${sim.worst_setup.setup} (${sim.worst_setup.win_rate}%)`} valueClass="text-rose-400" />
      )}

      {(sim.active_count ?? 0) > 0 && (
        <button onClick={() => setShowTrades(v => !v)} className="mt-3 flex w-full items-center justify-between rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
          <span>View Active Trades ({sim.active_count})</span>
          {showTrades ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      )}
      {showTrades && sim.active_trades?.map(t => (
        <div key={t.id} className="mt-1 flex items-center justify-between rounded-lg border border-slate-800 px-3 py-1.5 text-xs">
          <span className="font-semibold text-slate-200">{t.symbol}</span>
          <span className="text-slate-500">{t.execution_rating ?? t.setup_type ?? "—"}</span>
          <span className="text-slate-600">{t.entry_price != null ? `$${t.entry_price}` : "—"}</span>
          <span className="text-slate-600">{new Date(t.timestamp).toLocaleTimeString()}</span>
        </div>
      ))}
    </Card>
  );
}

function SignalFlowPanel() {
  const flowQuery = useQuery({ queryKey: ["admin", "signal-flow"], queryFn: () => apiGet<SignalFlowPayload>("/api/admin/signal-flow").catch(() => ({} as SignalFlowPayload)), ...QUERY_POLICY.fast, refetchInterval: 30_000 });
  const f = flowQuery.data ?? {};
  const stuck = f.stuck_signals ?? 0;

  return (
    <Card>
      <SectionHeader icon={Zap} title="Signal Flow Monitor" />
      {stuck > 0 && (
        <div className="mb-3 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-xs font-semibold text-rose-300">
          <XCircle className="mr-1.5 inline size-3" />
          {stuck} stuck signal{stuck === 1 ? "" : "s"} — unevaluated for &gt;1h
        </div>
      )}
      <div className="space-y-1.5">
        <StatRow label="Signals (last 5m)"   value={f.last_5m ?? 0} />
        <StatRow label="Signals (last 1h)"   value={f.last_1h ?? 0} />
        <StatRow label="Signals (24h)"       value={f.last_24h ?? 0} />
        <div className="mt-2 border-t border-slate-800/50" />
        <StatRow label="Evaluated (24h)"     value={f.evaluated_24h ?? 0}   valueClass="text-emerald-400" />
        <StatRow label="Unevaluated (24h)"   value={f.unevaluated_24h ?? 0} valueClass={(f.unevaluated_24h ?? 0) > 0 ? 'text-amber-400' : 'text-slate-400'} />
        <StatRow label="Stuck (&gt;1h)"      value={stuck}                   valueClass={stuck > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'} />
      </div>
      {f.last_24h === 0 && !flowQuery.isLoading && (
        <p className="mt-2 text-[10px] text-slate-600">No signals logged in the last 24h — premarket watchlist and execution engines must run first</p>
      )}
    </Card>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: () => apiGet<UsersPayload>("/api/admin/users").catch(() => ({ ok: false, users: [], count: 0 })), ...QUERY_POLICY.slow });

  const promoteMut  = useMutation({ mutationFn: (id: number) => apiPost(`/api/admin/users/${id}/promote`, {}),  onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }) });
  const disableMut  = useMutation({ mutationFn: (id: number) => apiPost(`/api/admin/users/${id}/disable`, {}),  onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }) });

  const users = usersQuery.data?.users ?? [];

  return (
    <Card>
      <SectionHeader icon={Users} title="User Management" badge={<span className="text-[10px] text-slate-600">{usersQuery.data?.count ?? 0} users</span>} />
      {users.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-600">
                <th className="pb-1.5 text-left">User</th>
                <th className="pb-1.5 text-left">Email</th>
                <th className="pb-1.5 text-center">Role</th>
                <th className="pb-1.5 text-center">Status</th>
                <th className="pb-1.5 text-right">Last Active</th>
                <th className="pb-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {users.map(u => (
                <tr key={u.id}>
                  <td className="py-1.5 font-medium text-slate-200">{u.username}</td>
                  <td className="py-1.5 text-slate-500">{u.email ?? "—"}</td>
                  <td className="py-1.5 text-center">
                    {u.is_admin ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">ADMIN</span>
                                : <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">USER</span>}
                  </td>
                  <td className="py-1.5 text-center">
                    {u.is_active ? <CheckCircle className="mx-auto size-3.5 text-emerald-400" /> : <XCircle className="mx-auto size-3.5 text-rose-400" />}
                  </td>
                  <td className="py-1.5 text-right text-slate-600">{u.last_login ? new Date(u.last_login).toLocaleDateString() : "—"}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      {!u.is_admin && (
                        <button onClick={() => promoteMut.mutate(u.id)} disabled={promoteMut.isPending}
                          className="rounded border border-amber-800/50 px-2 py-0.5 text-[10px] text-amber-400 hover:bg-amber-950/30 disabled:opacity-50">
                          Promote
                        </button>
                      )}
                      {u.is_active ? (
                        <button onClick={() => disableMut.mutate(u.id)} disabled={disableMut.isPending}
                          className="rounded border border-rose-800/50 px-2 py-0.5 text-[10px] text-rose-400 hover:bg-rose-950/30 disabled:opacity-50">
                          Disable
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] text-slate-600">Disabled</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : usersQuery.isLoading ? (
        <div className="space-y-1.5">{[...Array(4)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-slate-800/50" />)}</div>
      ) : (
        <p className="text-xs text-slate-600">No users found — table may not contain data yet</p>
      )}
    </Card>
  );
}

function NewsletterPanel() {
  const statsQuery = useQuery({ queryKey: ["admin", "newsletter-stats"], queryFn: () => apiGet<NewsletterStats>("/api/admin/newsletter-stats").catch(() => ({} as NewsletterStats)), ...QUERY_POLICY.slow });
  const subsQuery  = useQuery({ queryKey: ["admin", "newsletter-subs"], queryFn: () => apiGet<SubscribersPayload>("/api/admin/newsletter-subscribers").catch(() => ({ subscribers: [] })), ...QUERY_POLICY.slow });

  const stats = statsQuery.data ?? {};
  const subs  = subsQuery.data?.subscribers ?? [];

  return (
    <Card>
      <SectionHeader icon={Mail} title="Newsletter + Intel Feed" />
      <div className="mb-4 grid grid-cols-3 gap-2">
        {[
          { label: "Total Subscribers",  value: stats.total_subscribers ?? 0,   cls: "text-slate-200" },
          { label: "Active Subscribers", value: stats.active_subscribers ?? 0,   cls: "text-emerald-400" },
          { label: "Emails Recv (24h)",  value: stats.emails_received_24h ?? 0,  cls: "text-slate-400" },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-slate-800/50 px-3 py-2 text-center">
            <div className={`text-xl font-bold tabular-nums ${s.cls}`}>{s.value}</div>
            <div className="mt-0.5 text-[10px] text-slate-600">{s.label}</div>
          </div>
        ))}
      </div>
      {subs.length > 0 ? (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-800 text-[10px] uppercase text-slate-600"><th className="pb-1 text-left">Email</th><th className="pb-1 text-center">Active</th><th className="pb-1 text-right">Subscribed</th></tr></thead>
          <tbody className="divide-y divide-slate-800/50">
            {subs.map(s => (
              <tr key={s.email}>
                <td className="py-1 text-slate-300">{s.email}</td>
                <td className="py-1 text-center">{s.is_active ? <CheckCircle className="mx-auto size-3 text-emerald-400" /> : <XCircle className="mx-auto size-3 text-slate-600" />}</td>
                <td className="py-1 text-right text-slate-600">{s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !subsQuery.isLoading ? (
        <p className="text-xs text-slate-600">No subscribers yet — newsletter_subscribers table is empty</p>
      ) : (
        <div className="space-y-1">{[...Array(3)].map((_, i) => <div key={i} className="h-7 animate-pulse rounded bg-slate-800/50" />)}</div>
      )}
    </Card>
  );
}

function IntegrityPanel() {
  const intQuery = useQuery({ queryKey: ["admin", "data-integrity"], queryFn: () => apiGet<IntegrityPayload>("/api/admin/data-integrity").catch(() => ({} as IntegrityPayload)), ...QUERY_POLICY.slow, refetchInterval: 120_000 });
  const checks = intQuery.data?.checks ?? [];
  const issues = intQuery.data?.issues ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <SectionHeader icon={AlertTriangle} title="Data Integrity Checker" />
        {intQuery.data && (
          issues.length === 0
            ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle className="size-3" /> All clear</span>
            : <span className="flex items-center gap-1 text-[10px] text-rose-400"><AlertTriangle className="size-3" /> {issues.length} issue{issues.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      {checks.length > 0 ? (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-800 text-[10px] uppercase text-slate-600"><th className="pb-1 text-left">Issue</th><th className="pb-1 text-right">Count</th><th className="pb-1 text-center">Severity</th></tr></thead>
          <tbody className="divide-y divide-slate-800/50">
            {checks.map(c => (
              <tr key={c.issue}>
                <td className="py-1.5 font-mono text-[10px] text-slate-400">{c.issue}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-300">{c.count}</td>
                <td className="py-1.5 text-center">
                  {c.severity === 'OK'      && <span className="text-emerald-400">✓</span>}
                  {c.severity === 'MEDIUM'  && <span className="rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-400">MED</span>}
                  {c.severity === 'HIGH'    && <span className="rounded bg-rose-500/15 px-1.5 text-[10px] font-semibold text-rose-400">HIGH</span>}
                  {c.severity === 'UNKNOWN' && <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : intQuery.isLoading ? (
        <div className="space-y-1.5">{[...Array(5)].map((_, i) => <div key={i} className="h-7 animate-pulse rounded bg-slate-800/50" />)}</div>
      ) : (
        <p className="text-xs text-slate-600">Integrity checks unavailable — requires admin access</p>
      )}
    </Card>
  );
}

function EnginesPanel() {
  const qc = useQueryClient();
  const engQuery  = useQuery({ queryKey: ["admin", "engines"], queryFn: () => apiGet<EnginesPayload>("/api/admin/engines").catch(() => ({} as EnginesPayload)), ...QUERY_POLICY.medium, refetchInterval: 60_000 });
  const [running, setRunning] = useState<string | null>(null);

  const engines = engQuery.data?.engines ?? [];

  async function runEngine(name: string) {
    setRunning(name);
    try {
      await apiPost(`/api/admin/engines/${name}/run`, {});
      setTimeout(() => qc.invalidateQueries({ queryKey: ["admin", "engines"] }), 5000);
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card>
      <SectionHeader icon={Zap} title="Engine Control Panel" />
      {engines.length > 0 ? (
        <div className="space-y-1.5">
          {engines.map(e => (
            <div key={e.name} className="flex items-center justify-between rounded-lg border border-slate-800/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Dot color={e.status === 'running' ? 'green' : e.status === 'stale' ? 'amber' : 'unknown'} />
                  <span className="font-mono text-[11px] text-slate-300">{e.name}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-slate-600">Last run: {ageLabel(e.age_minutes)}</div>
              </div>
              <button
                onClick={() => runEngine(e.name)}
                disabled={running === e.name}
                className="ml-3 flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                <Play className={`size-2.5 ${running === e.name ? 'animate-spin' : ''}`} />
                Run
              </button>
            </div>
          ))}
        </div>
      ) : engQuery.isLoading ? (
        <div className="space-y-1.5">{[...Array(6)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-800/50" />)}</div>
      ) : (
        <p className="text-xs text-slate-600">Engine status unavailable — requires admin access</p>
      )}
    </Card>
  );
}

function LogsPanel() {
  const [filter, setFilter] = useState<"" | "INGEST" | "EVAL" | "ERROR" | "CRITICAL">("");
  const logsQuery = useQuery({
    queryKey: ["admin", "logs", filter],
    queryFn: () => apiGet<LogsPayload>(`/api/admin/logs${filter ? `?filter=${filter}` : ""}`).catch(() => ({} as LogsPayload)),
    ...QUERY_POLICY.medium,
    refetchInterval: 30_000,
  });

  const logs = logsQuery.data?.logs ?? [];

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SectionHeader icon={FileText} title="Log Viewer" />
        <div className="ml-auto flex items-center gap-1.5">
          {(["", "INGEST", "EVAL", "ERROR", "CRITICAL"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${filter === f ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
              {f || "ALL"}
            </button>
          ))}
        </div>
      </div>
      {logs.length > 0 ? (
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="rounded border border-slate-800/50 px-2.5 py-1.5 font-mono text-[10px]">
              <div className="flex items-start gap-2">
                <span className={`shrink-0 font-bold ${logLevelClass(log.level)}`}>[{log.level ?? "INFO"}]</span>
                <span className="text-slate-400 break-all">{log.message}</span>
              </div>
              <div className="mt-0.5 flex gap-3 text-slate-700">
                {log.label && <span>{log.label}</span>}
                {log.created_at && <span>{new Date(log.created_at).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : !logsQuery.isLoading ? (
        <p className="text-xs text-slate-600">No logs matching filter — signal errors will appear here when evaluation fails, or once system_logs table is populated</p>
      ) : (
        <div className="space-y-1">{[...Array(5)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-slate-800/50" />)}</div>
      )}
    </Card>
  );
}

// ─── Main admin view ──────────────────────────────────────────────────────────

export function AdminView() {
  const { isAdmin, initialized } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("Health");

  if (!initialized) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/50" />)}</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-rose-800/40 bg-rose-950/10 py-16 text-center">
        <Shield className="mb-3 size-10 text-rose-400/50" />
        <p className="text-sm font-semibold text-rose-300">Admin Access Required</p>
        <p className="mt-1 text-xs text-slate-600">This panel is restricted to admin users only</p>
      </div>
    );
  }

  function renderPanel() {
    switch (activeTab) {
      case "Health":      return <HealthPanel />;
      case "Pipeline":    return <PipelinePanel />;
      case "Signals":     return <SignalsPanel />;
      case "Simulation":  return <SimulationPanel />;
      case "Signal Flow": return <SignalFlowPanel />;
      case "Users":       return <UsersPanel />;
      case "Newsletter":  return <NewsletterPanel />;
      case "Integrity":   return <IntegrityPanel />;
      case "Engines":     return <EnginesPanel />;
      case "Logs":        return <LogsPanel />;
    }
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-100">Mission Control</h1>
          <p className="text-[11px] text-slate-600">System health · Data pipeline · Signal performance · Engine control</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-950/20 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          ADMIN
        </span>
      </div>

      {/* Top grid: Health + Pipeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HealthPanel />
        <PipelinePanel />
      </div>

      {/* Tab nav for detailed panels */}
      <div className="rounded-xl border border-slate-800 bg-[#0f1520]">
        <div className="flex overflow-x-auto border-b border-slate-800">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`shrink-0 px-3.5 py-2.5 text-[11px] font-medium transition ${activeTab === tab ? 'border-b-2 border-blue-500 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="p-4">
          {renderPanel()}
        </div>
      </div>

    </div>
  );
}
