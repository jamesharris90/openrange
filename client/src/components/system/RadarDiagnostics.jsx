function displayDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export default function RadarDiagnostics({ generatedAt, radar }) {
  const stocksInPlay = Array.isArray(radar?.stocks_in_play) ? radar.stocks_in_play.length : 0;
  const momentum = Array.isArray(radar?.momentum_leaders) ? radar.momentum_leaders.length : 0;
  const news = Array.isArray(radar?.news_catalysts) ? radar.news_catalysts.length : 0;
  const setups = Array.isArray(radar?.a_plus_setups) ? radar.a_plus_setups.length : 0;

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <h3 className="m-0 mb-3 text-base">Radar Diagnostics</h3>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between"><span>Generated At</span><strong>{displayDate(generatedAt)}</strong></div>
        <div className="flex items-center justify-between"><span>Stocks in Play</span><strong>{stocksInPlay}</strong></div>
        <div className="flex items-center justify-between"><span>Momentum Leaders</span><strong>{momentum}</strong></div>
        <div className="flex items-center justify-between"><span>News Catalysts</span><strong>{news}</strong></div>
        <div className="flex items-center justify-between"><span>A+ Setups</span><strong>{setups}</strong></div>
      </div>
    </section>
  );
}
