import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import SkeletonCard from '../ui/SkeletonCard';
import TickerLink from '../shared/TickerLink';
import { authFetch } from '../../utils/api';

function toNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value, digits = 2, suffix = '') {
  const num = toNum(value);
  if (num == null) return '--';
  return `${num.toFixed(digits)}${suffix}`;
}

function parseExpectedMove(payload, symbol) {
  const upper = String(symbol || '').toUpperCase();
  if (Array.isArray(payload)) {
    return payload.find((row) => String(row?.symbol || row?.ticker || '').toUpperCase() === upper) || null;
  }
  if (payload && typeof payload === 'object') return payload;
  return null;
}

function expectedMoveRange(row) {
  const price = toNum(row?.price);
  const move = toNum(row?.expected_move ?? row?.expectedMove);
  if (price == null || move == null) return null;
  return {
    low: Math.max(0, price - move),
    high: price + move,
    price,
    move,
  };
}

function keyLevelRows(levels, indicators, candles, quote) {
  const vwap = Array.isArray(indicators?.vwap) && indicators.vwap.length
    ? Number(indicators.vwap[indicators.vwap.length - 1])
    : null;
  const high = Array.isArray(candles) && candles.length
    ? Math.max(...candles.map((c) => Number(c?.high)).filter(Number.isFinite))
    : null;
  const low = Array.isArray(candles) && candles.length
    ? Math.min(...candles.map((c) => Number(c?.low)).filter(Number.isFinite))
    : null;

  const previousClose = toNum(
    quote?.previousClose
    ?? quote?.previous_close
    ?? quote?.prevClose
    ?? quote?.pc
    ?? quote?.closePrev
  );

  return [
    { label: 'Previous Close', value: previousClose },
    { label: 'Opening Range High', value: levels?.orHigh },
    { label: 'Opening Range Low', value: levels?.orLow },
    { label: 'VWAP', value: vwap },
    { label: 'Daily High', value: high },
    { label: 'Daily Low', value: low },
  ];
}

export default function SetupIntelligencePanel({ symbol, levels, indicators, candles }) {
  const [loading, setLoading] = useState(true);
  const [signal, setSignal] = useState(null);
  const [expectedMove, setExpectedMove] = useState(null);
  const [quote, setQuote] = useState(null);
  const [trend, setTrend] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!symbol) return;
      setLoading(true);
      try {
        const [signalRes, expectedRes, quoteRes, trendRes] = await Promise.all([
          authFetch(`/api/signals/${encodeURIComponent(symbol)}`),
          authFetch(`/api/expected-move?symbol=${encodeURIComponent(symbol)}`),
          authFetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
          authFetch(`/api/chart/trend/${encodeURIComponent(symbol)}`),
        ]);

        const signalPayload = signalRes.ok ? await signalRes.json() : null;
        const expectedPayload = expectedRes.ok ? await expectedRes.json() : null;
        const quotePayload = quoteRes.ok ? await quoteRes.json() : null;
        const trendPayload = trendRes.ok ? await trendRes.json() : null;

        if (cancelled) return;

        setSignal(signalPayload && typeof signalPayload === 'object' ? signalPayload : null);
        setExpectedMove(parseExpectedMove(expectedPayload, symbol));
        setQuote(quotePayload && typeof quotePayload === 'object' ? quotePayload : null);
        setTrend(trendPayload && typeof trendPayload === 'object' ? trendPayload : null);
      } catch {
        if (!cancelled) {
          setSignal(null);
          setExpectedMove(null);
          setQuote(null);
          setTrend(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const range = useMemo(() => expectedMoveRange(expectedMove), [expectedMove]);
  const levelRows = useMemo(() => keyLevelRows(levels, indicators, candles, quote), [levels, indicators, candles, quote]);

  if (loading) {
    return <SkeletonCard lines={10} />;
  }

  const strategy = signal?.strategy || signal?.setup_type || signal?.setup || '--';
  const score = signal?.score;
  const catalyst = signal?.catalyst || signal?.headline || signal?.catalyst_headline || 'No catalyst summary available.';
  const atr = toNum(signal?.atr ?? signal?.atr14 ?? indicators?.atr14?.[indicators?.atr14?.length - 1]);

  const support = Array.isArray(trend?.support) ? trend.support.filter((v) => Number.isFinite(Number(v))).slice(0, 2) : [];
  const resistance = Array.isArray(trend?.resistance) ? trend.resistance.filter((v) => Number.isFinite(Number(v))).slice(0, 2) : [];

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Setup Intelligence</h3>
        <TickerLink symbol={symbol} className="text-xs" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-[var(--border-default)] p-2"><div className="text-[var(--text-muted)]">Strategy</div><div className="font-semibold">{strategy}</div></div>
        <div className="rounded border border-[var(--border-default)] p-2"><div className="text-[var(--text-muted)]">Signal Score</div><div className="font-semibold">{fmt(score, 1)}</div></div>
        <div className="rounded border border-[var(--border-default)] p-2"><div className="text-[var(--text-muted)]">Gap %</div><div className="font-semibold">{fmt(signal?.gap_percent, 2, '%')}</div></div>
        <div className="rounded border border-[var(--border-default)] p-2"><div className="text-[var(--text-muted)]">RVOL</div><div className="font-semibold">{fmt(signal?.relative_volume ?? signal?.rvol, 2)}</div></div>
        <div className="rounded border border-[var(--border-default)] p-2"><div className="text-[var(--text-muted)]">Float</div><div className="font-semibold">{fmt(signal?.float, 0)}</div></div>
        <div className="rounded border border-[var(--border-default)] p-2"><div className="text-[var(--text-muted)]">ATR</div><div className="font-semibold">{fmt(atr, 2)}</div></div>
      </div>

      <div className="rounded border border-[var(--border-default)] p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Catalyst Summary</div>
        <div className="text-xs text-[var(--text-primary)]">{catalyst}</div>
      </div>

      <div className="rounded border border-[var(--border-default)] p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Expected Move</div>
        {!range ? (
          <div className="text-xs text-[var(--text-muted)]">Expected move unavailable.</div>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span>{fmt(range.low, 2)}</span>
              <span className="font-semibold">{fmt(range.price, 2)}</span>
              <span>{fmt(range.high, 2)}</span>
            </div>
            <div className="h-2 rounded bg-[var(--bg-elevated)]">
              <div className="h-full rounded bg-gradient-to-r from-rose-500 via-slate-400 to-emerald-500" style={{ width: '100%' }} />
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">Move ±{fmt(range.move, 2)}</div>
          </>
        )}
      </div>

      <div className="rounded border border-[var(--border-default)] p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Key Levels</div>
        <div className="space-y-1 text-xs">
          {levelRows.map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span>{item.label}</span>
              <strong>{fmt(item.value, 2)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-[var(--border-default)] p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Trend Levels</div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between"><span>Support</span><strong>{support.length ? support.map((v) => fmt(v, 2)).join(', ') : '--'}</strong></div>
          <div className="flex items-center justify-between"><span>Resistance</span><strong>{resistance.length ? resistance.map((v) => fmt(v, 2)).join(', ') : '--'}</strong></div>
        </div>
      </div>
    </Card>
  );
}
