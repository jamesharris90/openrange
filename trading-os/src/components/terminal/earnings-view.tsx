"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { getEarningsCalendar } from "@/lib/api/earnings";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

export function EarningsView() {
  const { data = [] } = useQuery({
    queryKey: queryKeys.earnings,
    queryFn: getEarningsCalendar,
    ...QUERY_POLICY.slow,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Earnings Calendar</div>
        <div className="grid grid-cols-5 gap-2 text-center text-xs text-slate-400">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
            <div key={day} className="rounded-lg border border-slate-800 py-3">{day}</div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Upcoming</div>
        <div className="space-y-2">
          {data.slice(0, 20).map((row) => (
            <Link
              key={`${row.symbol}-${row.earnings_date}`}
              href={`/research/${row.symbol}`}
              className="grid rounded-lg border border-slate-800 p-2 text-xs text-slate-300 hover:bg-slate-900 md:grid-cols-6"
            >
              <span>{row.symbol}</span>
              <span>{row.earnings_date}</span>
              <span>{(row.expected_move ?? 0).toFixed(2)}%</span>
              <span>{(row.actual_move ?? 0).toFixed(2)}%</span>
              <span>{row.beat_miss || "N/A"}</span>
              <span>{row.sector || "N/A"}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
