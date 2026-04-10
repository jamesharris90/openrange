import { useEffect, useMemo, useState } from "react";

type QuoteRow = {
  symbol?: string;
  price?: number;
  change_percent?: number;
};

type OpportunityRow = {
  symbol?: string;
  change_percent?: number;
  updated_at?: string;
  created_at?: string;
};

type TapeState = {
  loading: boolean;
  error: string | null;
  rows: QuoteRow[];
};

const STALE_WINDOW_MS = 15 * 60 * 1000;

function isFresh(value: unknown): boolean {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= STALE_WINDOW_MS;
}

export default function TickerTape() {
  const [state, setState] = useState<TapeState>({ loading: true, error: null, rows: [] });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [overviewRes, moversRes] = await Promise.all([
          fetch("/api/market/overview", { cache: "no-store" }),
          fetch("/api/intelligence/top-opportunities?limit=12", { cache: "no-store" }),
        ]);

        if (!overviewRes.ok || !moversRes.ok) {
          throw new Error("endpoint_failure");
        }

        const overview = await overviewRes.json();
        const movers = await moversRes.json();

        const indexSymbols = Object.keys(overview?.indices || {}).slice(0, 3);
        const topMovers = (Array.isArray(movers?.data) ? movers.data : [])
          .filter((row: OpportunityRow) => String(row.symbol || "").trim().length > 0)
          .filter((row: OpportunityRow) => isFresh(row.updated_at || row.created_at))
          .sort((a: OpportunityRow, b: OpportunityRow) => Math.abs(Number(b.change_percent || 0)) - Math.abs(Number(a.change_percent || 0)))
          .slice(0, 4)
          .map((row: OpportunityRow) => String(row.symbol || "").toUpperCase());

        const symbols = Array.from(new Set([...indexSymbols, ...topMovers])).filter(Boolean);
        if (symbols.length === 0) {
          throw new Error("no_symbols");
        }

        const quotesRes = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, {
          cache: "no-store",
        });
        if (!quotesRes.ok) {
          throw new Error("quotes_failure");
        }

        const quotesPayload = await quotesRes.json();
        const rows = Array.isArray(quotesPayload?.data) ? quotesPayload.data : [];

        if (!active) return;
        setState({ loading: false, error: rows.length ? null : "no_live_quotes", rows });
      } catch (error) {
        if (!active) return;
        setState({ loading: false, error: String((error as Error)?.message || "ticker_tape_error"), rows: [] });
      }
    }

    void load();
    const timer = window.setInterval(load, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const rows = useMemo(() => {
    return state.rows
      .map((row) => ({
        symbol: String(row.symbol || "").toUpperCase(),
        price: Number(row.price),
        changePercent: Number(row.change_percent),
      }))
      .filter((row) => row.symbol)
      .slice(0, 8);
  }, [state.rows]);

  if (state.loading) {
    return <div className="tickerTape">Loading live tape...</div>;
  }

  if (state.error || rows.length === 0) {
    return <div className="tickerTape">Ticker tape offline: no live market rows</div>;
  }

  return (
    <div className="tickerTape">
      {rows.map((row) => {
        const change = Number.isFinite(row.changePercent) ? row.changePercent : 0;
        return (
          <span key={row.symbol} className={change > 0 ? "text-emerald-400" : change < 0 ? "text-rose-400" : "text-amber-400"}>
            {row.symbol} {Number.isFinite(row.price) ? `$${row.price.toFixed(2)}` : "--"} {change.toFixed(2)}%
          </span>
        );
      })}
    </div>
  );
}
