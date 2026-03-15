export default function MarketBreadthCard({ data }) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-100">Market Breadth</h3>
      <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
        <p>Advancers: <span className="text-green-400">{data.advancers ?? '--'}</span></p>
        <p>Decliners: <span className="text-red-400">{data.decliners ?? '--'}</span></p>
        <p>Up Volume: {data.upVolume ?? '--'}</p>
        <p>Down Volume: {data.downVolume ?? '--'}</p>
      </div>
    </article>
  );
}
