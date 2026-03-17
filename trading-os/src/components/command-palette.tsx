"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useTickerStore } from "@/lib/store/ticker-store";

const baseCommands = [
  { id: "dashboard", label: "Open Dashboard", run: (router: ReturnType<typeof useRouter>) => router.push("/dashboard") },
  { id: "markets", label: "Open Markets", run: (router: ReturnType<typeof useRouter>) => router.push("/markets") },
  { id: "heatmap", label: "Open Heat Map", run: (router: ReturnType<typeof useRouter>) => router.push("/heat-map") },
  { id: "stocksInPlay", label: "Open Stocks In Play", run: (router: ReturnType<typeof useRouter>) => router.push("/stocks-in-play") },
  { id: "catalyst", label: "Open Catalyst Scanner", run: (router: ReturnType<typeof useRouter>) => router.push("/catalyst-scanner") },
  { id: "terminal", label: "Open Trading Terminal", run: (router: ReturnType<typeof useRouter>) => router.push("/trading-terminal") },
  { id: "earnings", label: "Open Earnings Calendar", run: (router: ReturnType<typeof useRouter>) => router.push("/earnings") },
  { id: "alerts", label: "Open Alerts", run: (router: ReturnType<typeof useRouter>) => router.push("/alerts") },
  { id: "admin", label: "Open Admin", run: (router: ReturnType<typeof useRouter>) => router.push("/admin") },
  { id: "settings", label: "Open Settings", run: (router: ReturnType<typeof useRouter>) => router.push("/settings") },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 150);
  const addWatch = useTickerStore((state) => state.addWatch);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const commands = useMemo(() => {
    const search = debounced.trim().toLowerCase();
    if (!search) return baseCommands;

    const dynamic = [];
    if (/^[a-z]{1,5}$/i.test(search)) {
      const ticker = search.toUpperCase();
      dynamic.push(
        {
          id: "research",
          label: `Open Research: ${ticker}`,
          run: (nextRouter: ReturnType<typeof useRouter>) => nextRouter.push(`/research/${ticker}`),
        },
        {
          id: "watchlist",
          label: `Add ${ticker} to Watchlist`,
          run: () => addWatch(ticker),
        }
      );
    }

    return [...dynamic, ...baseCommands].filter((command) => command.label.toLowerCase().includes(search));
  }, [debounced, addWatch]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-panel p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-2"
          aria-label="Command palette search"
          autoFocus
        />
        <ul className="max-h-80 overflow-y-auto">
          {commands.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900"
                onClick={() => {
                  command.run(router);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {command.label}
              </button>
            </li>
          ))}
          {commands.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No commands found</li>}
        </ul>
      </div>
    </div>
  );
}
