import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts';
import TickerIntelPanel from './TickerIntelPanel';

const FACTOR_HELP = {
  newsVolume: 'Weighted impact from headline count, freshness, and source reliability.',
  sentiment: 'Net tone and directional language strength across relevant inputs.',
  clustering: 'How tightly the narrative clusters around related symbols and theme.',
  macroAlignment: 'Alignment with broader market regime and macro catalysts.',
  momentum: 'Confirmation from price/volume trend persistence signals.',
};

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function factorRows(scoreBreakdown = {}) {
  const b = scoreBreakdown || {};
  return [
    { key: 'newsVolume', label: 'News Volume', value: toNum(b.newsVolume, b.news_volume), tip: FACTOR_HELP.newsVolume },
    { key: 'sentiment', label: 'Sentiment Strength', value: toNum(b.sentiment, b.sentiment_strength), tip: FACTOR_HELP.sentiment },
    { key: 'clustering', label: 'Ticker Clustering', value: toNum(b.clustering, b.ticker_clustering), tip: FACTOR_HELP.clustering },
    { key: 'macroAlignment', label: 'Macro Alignment', value: toNum(b.macroAlignment, b.macro_alignment), tip: FACTOR_HELP.macroAlignment },
    { key: 'momentum', label: 'Momentum Signal', value: toNum(b.momentum, b.momentum_signal), tip: FACTOR_HELP.momentum },
  ];
}

function confidenceToPct(confidence) {
  const n = toNum(confidence);
  if (n <= 1) return Math.max(0, n * 100);
  return Math.max(0, Math.min(100, n));
}

export default function IntelDetailPanel({ open, detail, onClose, onOpenSetup }) {
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerSymbol, setTickerSymbol] = useState('');

  const rows = useMemo(() => factorRows(detail?.score_breakdown), [detail?.score_breakdown]);
  const totalScore = useMemo(() => rows.reduce((acc, row) => acc + toNum(row.value), 0), [rows]);
  const confidencePct = confidenceToPct(detail?.confidence);

  if (!open || !detail) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/55" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[61] h-full w-full max-w-4xl overflow-y-auto border-l border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border-color)] pb-3">
          <div>
            <h2 className="m-0 text-lg">{detail?.title || detail?.narrative_title || 'Intelligence Detail'}</h2>
            <div className="muted mt-1 text-xs">
              {detail?.sector || detail?.theme || 'Market'} • Confidence {confidencePct.toFixed(0)}% • Regime {detail?.regime || 'neutral'}
            </div>
          </div>
          <button type="button" className="rounded border border-[var(--border-color)] px-2 py-1 text-xs" onClick={onClose}>Close</button>
        </div>

        <section className="mb-4 rounded border border-[var(--border-color)] p-3">
          <h3 className="m-0 mb-2 text-sm">MCP Narrative</h3>
          <div className="text-sm leading-relaxed">{detail?.narrative || detail?.narrative_explanation || 'No narrative explanation available.'}</div>
          <div className="muted mt-2 grid gap-1 text-xs md:grid-cols-4">
            <div>Confidence: {confidencePct.toFixed(0)}%</div>
            <div>Type: {detail?.narrative_type || 'sector'}</div>
            <div>Horizon: {detail?.time_horizon || 'intraday'}</div>
            <div>Regime: {detail?.regime || 'neutral'}</div>
          </div>
        </section>

        <section className="mb-4 rounded border border-[var(--border-color)] p-3">
          <h3 className="m-0 mb-2 text-sm">Score Breakdown</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 12, right: 8, left: 8, bottom: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} angle={-20} textAnchor="end" height={60} interval={0} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <Tooltip formatter={(val) => Number(val).toFixed(2)} />
                  <Bar dataKey="value" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart innerRadius="60%" outerRadius="95%" data={[{ value: confidencePct }]} startAngle={180} endAngle={0}>
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar dataKey="value" fill="#22c55e" cornerRadius={8} />
                    <text x="50%" y="58%" textAnchor="middle" fill="#e2e8f0" fontSize="18" fontWeight="700">{confidencePct.toFixed(0)}%</text>
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded border border-[var(--border-color)] p-2 text-xs">
                {rows.map((row) => (
                  <div key={row.key} className="mb-1 flex items-center justify-between" title={row.tip}>
                    <span>{row.label}</span>
                    <strong>{toNum(row.value).toFixed(2)}</strong>
                  </div>
                ))}
                <div className="mt-2 border-t border-[var(--border-color)] pt-2 font-semibold">Total Confidence Score = {totalScore.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-4 rounded border border-[var(--border-color)] p-3">
          <h3 className="m-0 mb-2 text-sm">Data Sources</h3>
          {!Array.isArray(detail?.data_sources) || !detail.data_sources.length ? (
            <div className="muted text-xs">No data sources provided.</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {detail.data_sources.map((source, idx) => (
                <a
                  key={`${idx}-${source?.title || source?.type || 'source'}`}
                  href={source?.url || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-[var(--border-color)] p-2 text-xs hover:bg-[var(--bg-card-hover)]"
                >
                  <div className="font-semibold">{source?.type || 'source'}</div>
                  <div>{source?.title || source?.headline || 'Untitled source'}</div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section className="mb-4 rounded border border-[var(--border-color)] p-3">
          <h3 className="m-0 mb-2 text-sm">Affected Tickers</h3>
          {!Array.isArray(detail?.affected_tickers) || !detail.affected_tickers.length ? (
            <div className="muted text-xs">No affected tickers available.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {detail.affected_tickers.map((ticker, idx) => {
                const s = String(ticker?.symbol || ticker).toUpperCase();
                const intensity = Math.max(0.1, Math.min(1, toNum(ticker?.intensity, 0.45)));
                return (
                  <button
                    key={`${s}-${idx}`}
                    type="button"
                    className="rounded border px-2 py-2 text-sm font-semibold"
                    style={{ borderColor: 'var(--border-color)', background: `rgba(34,197,94,${intensity * 0.35})` }}
                    onClick={() => {
                      setTickerSymbol(s);
                      setTickerOpen(true);
                    }}
                    title={`Open ${s} intelligence`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="mb-4 rounded border border-[var(--border-color)] p-3">
          <h3 className="m-0 mb-2 text-sm">Trade Setups</h3>
          {!Array.isArray(detail?.setups) || !detail.setups.length ? (
            <div className="muted text-xs">No mapped setups available.</div>
          ) : (
            <div className="space-y-2">
              {detail.setups.map((setup, idx) => (
                <button
                  key={`${setup?.name || 'setup'}-${idx}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded border border-[var(--border-color)] px-2 py-2 text-left hover:bg-[var(--bg-card-hover)]"
                  onClick={() => onOpenSetup?.(setup)}
                >
                  <span>{setup?.name || setup?.label || 'Setup'}</span>
                  <span className="muted text-xs">Probability {toNum(setup?.probability, 0).toFixed(0)}%</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded border border-[var(--border-color)] p-3">
          <h3 className="m-0 mb-2 text-sm">Trade Playbook</h3>
          <div className="space-y-1 text-sm">
            <div>Preferred trade style: {detail?.playbook?.style || 'momentum continuation'}</div>
            <div>Execution trigger: {detail?.playbook?.trigger || 'Pullback to VWAP with reclaim and volume confirmation'}</div>
            <div>Best window: {detail?.playbook?.window || 'First 60 minutes of US open'}</div>
          </div>
        </section>
      </aside>

      <TickerIntelPanel
        open={tickerOpen}
        symbol={tickerSymbol}
        onClose={() => setTickerOpen(false)}
        onOpenSetup={onOpenSetup}
      />
    </>
  );
}
