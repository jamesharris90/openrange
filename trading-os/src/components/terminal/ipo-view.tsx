"use client";

import { useEffect, useState, useMemo } from "react";

// ── types ─────────────────────────────────────────────────────────────────────

type IpoEvent = {
  symbol?: string | null;
  companyName?: string | null;
  exchange?: string | null;
  priceRange?: string | null;        // "19.00 - 22.00" from DB
  priceRangeLow?: number | null;     // legacy
  priceRangeHigh?: number | null;    // legacy
  listingPrice?: number | null;      // live price from batch-quote
  sharesOffered?: number | null;
  actions?: string | null;           // Expected / Priced / Withdrawn
  marketCap?: number | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  ipoDate?: string | null;
};

type IpoDay = { date: string; label: string; events: IpoEvent[] };

type ApiResponse = {
  weekStart?: string;
  weekEnd?: string;
  weekOffset?: number;
  totalEvents?: number;
  days?: IpoDay[];
  error?: string;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShares(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function fmtPriceRange(ipo: IpoEvent): { text: string; dimmed: boolean } {
  // DB returns price_range as a string e.g. "19.00 - 22.00"
  if (ipo.priceRange) {
    const text = ipo.priceRange.includes("-") ? `$${ipo.priceRange.replace("-", "–")}` : ipo.priceRange;
    return { text, dimmed: false };
  }
  // Legacy numeric fields
  const low = ipo.priceRangeLow, high = ipo.priceRangeHigh;
  if (low != null && high != null) return { text: `$${Number(low).toFixed(2)} – $${Number(high).toFixed(2)}`, dimmed: false };
  if (high != null) return { text: `Up to $${Number(high).toFixed(2)}`, dimmed: false };
  if (low != null) return { text: `$${Number(low).toFixed(2)}`, dimmed: false };
  // Fall back to live listing price
  if (ipo.listingPrice != null && Number.isFinite(Number(ipo.listingPrice))) {
    return { text: `$${Number(ipo.listingPrice).toFixed(2)}`, dimmed: true };
  }
  return { text: "—", dimmed: true };
}

function fmtMarketCap(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

const ACTIONS_STYLE: Record<string, string> = {
  priced:    "bg-[var(--bull)]/15 text-[var(--bull)] border-[var(--bull)]/30",
  expected:  "bg-amber-500/15 text-amber-500 border-amber-500/30",
  withdrawn: "bg-[var(--bear)]/15 text-[var(--bear)] border-[var(--bear)]/30",
  filed:     "bg-blue-500/15 text-blue-500 border-blue-500/30",
};

function actionsStyle(s: string | null | undefined) {
  if (!s) return "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]";
  const k = s.toLowerCase();
  for (const [key, cls] of Object.entries(ACTIONS_STYLE)) {
    if (k.includes(key)) return cls;
  }
  return "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]";
}

// ── component ─────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseDayLabel(isoStr: string) {
  const d = new Date(isoStr + "T00:00:00Z");
  const dow = d.getUTCDay();
  return `${DAY_LABELS[dow === 0 ? 6 : dow - 1]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function IpoView() {
  const [weekOffset,   setWeekOffset]   = useState(0);
  const [data,         setData]         = useState<ApiResponse | null>(null);
  const [selectedDay,  setSelectedDay]  = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/ipo/calendar?weekOffset=${weekOffset}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        setData(d);
        // auto-select first day with events
        const first = d.days?.find((day) => day.events.length > 0)?.date;
        setSelectedDay(first ?? d.days?.[0]?.date ?? null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [weekOffset]);

  const dayRows = useMemo(() => {
    if (!selectedDay || !data?.days) return [];
    return data.days.find((d) => d.date === selectedDay)?.events ?? [];
  }, [data, selectedDay]);

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <h1 className="text-sm font-semibold text-[var(--foreground)]">IPO Calendar</h1>
        {data && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {data.weekStart} – {data.weekEnd}
            {(data.totalEvents ?? 0) > 0 && ` · ${data.totalEvents} IPOs`}
          </span>
        )}
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
      </div>

      {/* ── Day tabs ── */}
      <div className="flex gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0 overflow-x-auto">
        {(data?.days ?? []).map((day) => {
          const count = day.events.length;
          const isToday = day.date === todayIso;
          const isSelected = day.date === selectedDay;
          return (
            <button
              key={day.date}
              onClick={() => setSelectedDay(day.date)}
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
                {parseDayLabel(day.date)}
              </span>
              <span className={`mt-1 flex items-center gap-1 text-[11px] ${count > 0 ? "text-[var(--muted-foreground)]" : "text-[var(--muted-foreground)]/40"}`}>
                {count > 0 && <span className={`inline-block w-1.5 h-1.5 rounded-full ${isSelected ? "bg-blue-500" : "bg-[var(--muted-foreground)]"}`} />}
                {count > 0 ? `${count} IPO${count !== 1 ? "s" : ""}` : "—"}
              </span>
            </button>
          );
        })}
        {!data && !loading && (
          <div className="text-xs text-[var(--muted-foreground)] self-center">No data</div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {loading && <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">Loading…</div>}
        {error && (
          <div className="m-4 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>
        )}
        {!loading && !error && (
          <>
            {selectedDay && (
              <div className="px-4 py-2 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide border-b border-[var(--border)] bg-[var(--panel)]">
                IPOs on {parseDayLabel(selectedDay)} · {dayRows.length} offering{dayRows.length !== 1 ? "s" : ""}
              </div>
            )}
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--panel)] border-b border-[var(--border)]">
                <tr>
                  {["Symbol","Company","Sector","Exchange","Price / Range","Shares Offered","Mkt Cap","Status"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wide font-medium text-[var(--muted-foreground)] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center">
                      <div className="text-sm text-[var(--muted-foreground)] mb-1">
                        {selectedDay ? "No IPOs on this day" : "Select a day above"}
                      </div>
                      {data && data.totalEvents === 0 && (
                        <div className="text-[11px] text-[var(--muted-foreground)]/60 max-w-sm mx-auto mt-2">
                          IPO calendar data is sourced from FMP. Upcoming IPO listings may not be available on the current data plan.
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                {dayRows.map((ipo, i) => {
                  const priceRange = fmtPriceRange(ipo);
                  const mcap = fmtMarketCap(ipo.marketCap);
                  return (
                    <tr key={`${ipo.symbol ?? i}-${i}`}
                      title={ipo.description ?? undefined}
                      className={`border-b border-[var(--border)] transition-colors ${i % 2 !== 0 ? "bg-[var(--muted)]/30" : ""} hover:bg-[var(--muted)]`}>
                      <td className="px-3 py-2.5 font-semibold text-blue-500 text-xs tracking-wide whitespace-nowrap">
                        {ipo.symbol ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--foreground)] text-xs max-w-[200px] truncate">
                        {ipo.companyName ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--muted-foreground)] text-xs max-w-[120px] truncate">
                        {ipo.sector ?? (ipo.industry ?? "—")}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--muted-foreground)] text-xs">
                        {ipo.exchange ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        <span className={priceRange.dimmed ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}>
                          {priceRange.text}
                          {priceRange.dimmed && priceRange.text !== "—" && (
                            <span className="ml-1 text-[9px] opacity-60">live</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--foreground)]">
                        {fmtShares(ipo.sharesOffered)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-[var(--foreground)]">
                        {mcap ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {ipo.actions ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border tracking-wide ${actionsStyle(ipo.actions)}`}>
                            {ipo.actions}
                          </span>
                        ) : <span className="text-[var(--muted-foreground)] text-xs">—</span>}
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
