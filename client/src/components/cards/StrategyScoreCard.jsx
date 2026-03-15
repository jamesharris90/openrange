export default function StrategyScoreCard({ strategy }) {
  const winRate = Number(strategy.win_rate || 0) * (Math.abs(Number(strategy.win_rate || 0)) <= 1 ? 100 : 1);
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-100">{strategy.strategy || 'Strategy'}</h3>
      <div className="space-y-1 text-sm text-slate-300">
        <p>Win Rate: <span className="text-green-400">{winRate.toFixed(1)}%</span></p>
        <p>Edge: <span className="text-blue-400">{Number(strategy.edge_score || 0).toFixed(3)}</span></p>
        <p>Samples: {strategy.signals_count || strategy.samples || 0}</p>
      </div>
    </article>
  );
}
