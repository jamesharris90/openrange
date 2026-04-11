import Link from "next/link";

const WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA"];

export default function ResearchIndexPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.14),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.08),transparent_30%),#020617] px-4 py-10 md:px-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-4">
          <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-300/75">Research</div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-50 md:text-5xl">Cached research views for active symbols.</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            Open any symbol-specific route to load overview, price, fundamentals, earnings, flow, and context from the backend research cache.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {WATCHLIST.map((ticker) => (
            <Link
              key={ticker}
              href={`/research-v2/${ticker}`}
              className="rounded-[1.75rem] border border-slate-800/80 bg-slate-950/45 p-6 transition hover:border-cyan-500/40 hover:bg-slate-900/70"
            >
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Open Snapshot</div>
              <div className="mt-3 text-2xl font-semibold text-slate-100">{ticker}</div>
              <div className="mt-2 text-sm text-slate-400">Launch the production research surface for {ticker}.</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
