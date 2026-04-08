"use client";

import { useState } from "react";

// ── types ──────────────────────────────────────────────────────────────────────

export type EarningsEvent = {
  report_date?: string | null;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  surprise?: number | null;
  time?: string | null;
};

export type EarningsTimelineProps = {
  earnings: EarningsEvent[];
  todayIso: string;
};

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "2-digit", timeZone: "UTC",
  });
}

function fmtEps(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `${v >= 0 ? "$" : "-$"}${Math.abs(v).toFixed(2)}`;
}

type DotState = "beat" | "miss" | "upcoming" | "nodata";

function dotState(e: EarningsEvent, todayIso: string): DotState {
  const isPast = (e.report_date ?? "") < todayIso;
  if (!isPast) return "upcoming";
  if (e.eps_actual == null || e.eps_estimate == null) return "nodata";
  return Number(e.eps_actual) >= Number(e.eps_estimate) ? "beat" : "miss";
}

const DOT_CFG: Record<DotState, { ring: string; fill: string; label: string }> = {
  beat:     { ring: "ring-[var(--bull)]/40",  fill: "bg-[var(--bull)]",          label: "Beat" },
  miss:     { ring: "ring-[var(--bear)]/40",  fill: "bg-[var(--bear)]",          label: "Miss" },
  upcoming: { ring: "ring-amber-500/40",      fill: "bg-amber-500",              label: "Upcoming" },
  nodata:   { ring: "ring-slate-600/40",      fill: "bg-slate-600",              label: "No data" },
};

// ── component ─────────────────────────────────────────────────────────────────

export function EarningsTimeline({ earnings, todayIso }: EarningsTimelineProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // Sort by date ascending, show max 8
  const sorted = [...earnings]
    .filter(e => e.report_date)
    .sort((a, b) => (a.report_date! > b.report_date! ? 1 : -1))
    .slice(-8);

  if (sorted.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-3">
        Earnings History
      </p>

      <div className="relative">
        {/* Connector line */}
        <div className="absolute top-[9px] left-0 right-0 h-px bg-[var(--border)] z-0" />

        {/* Dots row */}
        <div className="relative z-10 flex items-start gap-0 justify-between">
          {sorted.map((e, i) => {
            const state  = dotState(e, todayIso);
            const cfg    = DOT_CFG[state];
            const surp   = e.surprise != null ? Number(e.surprise) : null;
            const isOpen = activeIdx === i;

            return (
              <div
                key={e.report_date ?? i}
                className="flex flex-col items-center gap-1.5 cursor-pointer group flex-1"
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                {/* Dot */}
                <div className={`w-[18px] h-[18px] rounded-full ring-2 ${cfg.ring} ${cfg.fill} transition-transform duration-150 group-hover:scale-125 shrink-0`} />

                {/* Date label */}
                <span className="text-[9px] text-[var(--muted-foreground)] text-center leading-tight whitespace-nowrap">
                  {fmtDate(e.report_date)}
                </span>

                {/* Surprise label */}
                {surp != null && (
                  <span className={`text-[9px] font-mono font-bold ${surp >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                    {surp >= 0 ? "+" : ""}{surp.toFixed(1)}%
                  </span>
                )}

                {/* Tooltip */}
                {isOpen && (
                  <div className="absolute bottom-full mb-2 z-20 w-44 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl p-3 pointer-events-none"
                    style={{ left: "50%", transform: "translateX(-50%)" }}>
                    <p className="text-[10px] font-semibold text-[var(--foreground)] mb-2">{fmtDate(e.report_date)}</p>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--muted-foreground)]">EPS Est</span>
                        <span className="font-mono text-[var(--foreground)]">{fmtEps(e.eps_estimate)}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-[var(--muted-foreground)]">EPS Act</span>
                        <span className={`font-mono font-semibold ${
                          e.eps_actual != null && e.eps_estimate != null
                            ? Number(e.eps_actual) >= Number(e.eps_estimate) ? "text-[var(--bull)]" : "text-[var(--bear)]"
                            : "text-[var(--foreground)]"
                        }`}>{fmtEps(e.eps_actual)}</span>
                      </div>
                      {surp != null && (
                        <div className="flex justify-between text-[11px] pt-1 border-t border-[var(--border)]">
                          <span className="text-[var(--muted-foreground)]">Surprise</span>
                          <span className={`font-mono font-bold ${surp >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
                            {surp >= 0 ? "+" : ""}{surp.toFixed(2)}%
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between text-[11px] pt-1 border-t border-[var(--border)]">
                        <span className="text-[var(--muted-foreground)]">Status</span>
                        <span className={`font-semibold text-[10px] uppercase tracking-wide ${
                          state === "beat" ? "text-[var(--bull)]" :
                          state === "miss" ? "text-[var(--bear)]" :
                          state === "upcoming" ? "text-amber-500" :
                          "text-[var(--muted-foreground)]"
                        }`}>{cfg.label}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4">
        {(["beat", "miss", "upcoming", "nodata"] as DotState[]).map(s => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${DOT_CFG[s].fill}`} />
            <span className="text-[10px] text-[var(--muted-foreground)]">{DOT_CFG[s].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
