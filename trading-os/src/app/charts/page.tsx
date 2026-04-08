"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { ChartEngine } from "@/components/charts/chart-engine";

type Timeframe = "1m" | "5m" | "daily";

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: "1m",    value: "1m"    },
  { label: "5m",    value: "5m"    },
  { label: "Daily", value: "daily" },
];

const DEFAULT_SYMBOL = "SPY";

export default function ChartsPage() {
  const [inputValue, setInputValue] = useState("");
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [timeframe, setTimeframe] = useState<Timeframe>("daily");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = inputValue.trim().toUpperCase();
    if (t) {
      setSymbol(t);
      setInputValue("");
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Symbol input */}
        <form onSubmit={handleSubmit} className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-slate-500" />
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={symbol}
            className="w-36 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
          />
          <button
            type="submit"
            className="ml-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
          >
            Go
          </button>
        </form>

        {/* Active symbol badge */}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300">
          {symbol}
        </div>

        {/* Timeframe selector */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                timeframe === tf.value
                  ? "bg-slate-700 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart — fills remaining vertical space */}
      <div className="flex-1 rounded-2xl border border-slate-800 bg-[#121826] overflow-hidden min-h-[500px]">
        <ChartEngine ticker={symbol} timeframe={timeframe} />
      </div>
    </div>
  );
}
