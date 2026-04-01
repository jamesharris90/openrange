import Link from "next/link";

type Props = {
  params: {
    symbol: string;
  };
};

export default function ResearchV2SymbolPage({ params }: Props) {
  const symbol = params.symbol.toUpperCase();

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-8 text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Research V2</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{symbol}</h1>
      <p className="mt-3 max-w-2xl text-sm text-slate-400">
        Research V2 is not built yet. This route exists so the new screener can link to a clean v2 destination without sending you back into the legacy research flow.
      </p>
      <Link
        href="/screener-v2"
        className="mt-6 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
      >
        Back to Screener V2
      </Link>
    </section>
  );
}