"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

// ── types ─────────────────────────────────────────────────────────────────────

type EarningsRow = {
  symbol: string;
  company_name?: string | null;
  report_date: string;
  time?: string;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  surprise?: number | null;
  expected_move_percent?: number | null;
  market_cap?: string | number | null;
  sector?: string | null;
  score?: number | null;
};

type ApiResponse = {
  success?: boolean;
  data?: EarningsRow[];
  rows?: EarningsRow[];
  ok?: boolean;
  items?: EarningsRow[];
};

// ── helpers ───────────────────────────────────────────────────────────────────

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function mondayOf(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dayLabel(d: Date) {
  return `${DAY_LABELS[d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1]} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function fmtMcap(v: string | number | null | undefined) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(0)}M`;
  return "—";
}

function fmtEps(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return `${n >= 0 ? "" : ""}${n.toFixed(2)}`;
}

function fmtSurprise(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  return { text: `${n > 0 ? "+" : ""}${n.toFixed(1)}%`, positive: n >= 0 };
}

function normaliseTime(t: unknown) {
  const s = String(t || "").toUpperCase();
  if (s.includes("BMO") || s.includes("PRE") || s.includes("BEFORE")) return "BMO";
  if (s.includes("AMC") || s.includes("AFTER")) return "AMC";
  if (s.includes("TNS") || s.includes("TNS")) return "TNS";
  return "TBD";
}

const TIME_PILL: Record<string, string> = {
  BMO: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  AMC: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  TNS: "bg-slate-500/15 text-[var(--muted-foreground)] border-[var(--border)]",
  TBD: "bg-slate-500/15 text-[var(--muted-foreground)] border-[var(--border)]",
};

// ── component ─────────────────────────────────────────────────────────────────

export function EarningsView() {
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [rows, setRows] = useState<EarningsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // compute week
  const baseMonday = useMemo(() => mondayOf(new Date()), []);
  const monday = useMemo(() => addDays(baseMonday, weekOffset * 7), [baseMonday, weekOffset]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const todayIso = useMemo(() => isoDate(new Date()), []);

  // fetch whenever week changes
  useEffect(() => {
    const from = isoDate(monday);
    const to = isoDate(addDays(monday, 6));
    setLoading(true);
    setError(null);
    fetch(`/api/earnings/calendar?from=${from}&to=${to}&limit=600`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        const list = d.data ?? d.rows ?? d.items ?? [];
        setRows(Array.isArray(list) ? list : []);
        // default to first day that has events, or today
        const counts = new Map<string, number>();
        for (const row of list) {
          const k = String(row.report_date || "").slice(0, 10);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        const firstWithEvents = weekDays.map(isoDate).find((d) => (counts.get(d) ?? 0) > 0);
        setSelectedDay((prev) => prev ?? firstWithEvents ?? isoDate(monday));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [monday, weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  // counts per day
  const countsByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = String(r.report_date || "").slice(0, 10);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  // rows for selected day, filtered by search
  const dayRows = useMemo(() => {
    if (!selectedDay) return [];
    const q = search.trim().toUpperCase();
    return rows
      .filter((r) => String(r.report_date || "").slice(0, 10) === selectedDay)
      .filter((r) => !q || String(r.symbol || "").toUpperCase().includes(q) || String(r.sector || "").toUpperCase().includes(q) || String(r.company_name || "").toUpperCase().includes(q))
      .sort((a, b) => (Number(b.market_cap) || 0) - (Number(a.market_cap) || 0));
  }, [rows, selectedDay, search]);

  const selectedDayLabel = selectedDay
    ? dayLabel(new Date(selectedDay + "T00:00:00Z"))
    : "";

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">

      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <h1 className="text-sm font-semibold text-[var(--foreground)]">Earnings Calendar</h1>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => { setWeekOffset((w) => w - 1); setSelectedDay(null); }}
            className="px-2.5 py-1 rounded border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">←</button>
          {weekOffset !== 0 && (
            <button onClick={() => { setWeekOffset(0); setSelectedDay(null); }}
              className="px-2.5 py-1 rounded border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">This Week</button>
          )}
          <button onClick={() => { setWeekOffset((w) => w + 1); setSelectedDay(null); }}
            className="px-2.5 py-1 rounded border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">→</button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter symbol / company / sector…"
          className="w-44 rounded border border-[var(--border)] bg-[var(--input)] px-2.5 py-1 text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* ── Day tab strip ── */}
      <div className="flex gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0 overflow-x-auto">
        {weekDays.map((d) => {
          const k = isoDate(d);
          const count = countsByDay.get(k) ?? 0;
          const isToday = k === todayIso;
          const isSelected = k === selectedDay;
          return (
            <button
              key={k}
              onClick={() => setSelectedDay(k)}
              className={[
                "flex flex-col items-start shrink-0 rounded-xl border px-4 py-2.5 text-left transition-colors min-w-[110px]",
                isSelected
                  ? "border-blue-500 bg-blue-500/10"
                  : isToday
                    ? "border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10"
                    : "border-[var(--border)] hover:bg-[var(--muted)]",
              ].join(" ")}
            >
              <span className={`text-xs font-semibold ${isSelected ? "text-blue-500" : isToday ? "text-blue-400" : "text-[var(--foreground)]"}`}>
                {dayLabel(d)}
              </span>
              <span className={`mt-1 flex items-center gap-1 text-[11px] ${count > 0 ? "text-[var(--muted-foreground)]" : "text-[var(--muted-foreground)]/40"}`}>
                {count > 0 && <span className={`inline-block w-1.5 h-1.5 rounded-full ${isSelected ? "bg-blue-500" : "bg-[var(--muted-foreground)]"}`} />}
                {count > 0 ? `${count} Earnings` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>
        )}
        {error && (
          <div className="m-4 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>
        )}
        {!loading && !error && (
          <>
            {selectedDay && (
              <div className="px-4 py-2 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide border-b border-[var(--border)] bg-[var(--panel)]">
                Earnings on {selectedDayLabel} · {dayRows.length} companies
              </div>
            )}
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border)]">
                <tr>
                  {["Symbol","Company","Sector","Call Time","EPS Est","Reported EPS","Surprise","Exp Move","Mkt Cap","Score"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wide font-medium text-[var(--muted-foreground)] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="px-3 py-16 text-center text-sm text-[var(--muted-foreground)]">
                      {selectedDay ? "No earnings on this day" : "Select a day above"}
                    </td>
                  </tr>
                )}
                {dayRows.map((row, i) => {
                  const timeKey = normaliseTime(row.time);
                  const surprise = fmtSurprise(row.surprise);
                  const expMove = row.expected_move_percent != null ? `±${Number(row.expected_move_percent).toFixed(1)}%` : "—";
                  return (
                    <tr key={`${row.symbol}-${i}`}
                      onClick={() => router.push(`/research/${row.symbol}`)}
                      className={`border-b border-[var(--border)] transition-colors cursor-pointer ${i % 2 !== 0 ? "bg-[var(--muted)]/30" : ""} hover:bg-[var(--muted)]`}>
                      <td className="px-3 py-2.5 font-semibold text-blue-500 text-xs tracking-wide whitespace-nowrap">
                        {row.symbol}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--foreground)] text-xs max-w-[180px] truncate">
                        {row.company_name || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--muted-foreground)] text-xs max-w-[120px] truncate">
                        {row.sector || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TIME_PILL[timeKey] ?? TIME_PILL.TBD}`}>
                          {timeKey}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">
                        {fmtEps(row.eps_estimate)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">
                        {fmtEps(row.eps_actual)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {surprise
                          ? <span className={surprise.positive ? "text-[var(--bull)]" : "text-[var(--bear)]"}>{surprise.text}</span>
                          : <span className="text-[var(--muted-foreground)]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-amber-500">
                        {expMove}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--foreground)]">
                        {fmtMcap(row.market_cap)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                        {row.score != null ? Number(row.score).toFixed(0) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
