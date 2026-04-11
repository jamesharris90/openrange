"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useTickerStore } from "@/lib/store/ticker-store";

export function TickerSearch() {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 180);
  const router = useRouter();
  const setTicker = useTickerStore((state) => state.setTicker);
  const watchlist = useTickerStore((state) => state.watchlist);

  const suggestions = useMemo(() => {
    const search = debounced.trim().toUpperCase();
    if (!search) return [];
    return watchlist.filter((symbol) => symbol.startsWith(search)).slice(0, 6);
  }, [debounced, watchlist]);

  const goToTicker = (ticker: string) => {
    setTicker(ticker);
    router.push(`/research-v2/${encodeURIComponent(ticker)}`);
    setQuery("");
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = query.trim().toUpperCase();
    if (!ticker) return;
    goToTicker(ticker);
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Ticker search"
        className="pl-9 font-mono text-xs tracking-wide"
      />
      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-[110%] z-40 rounded-xl border border-slate-800 bg-panel p-1 shadow-2xl">
          {suggestions.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className="block w-full rounded-lg px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-900"
              onClick={() => goToTicker(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
