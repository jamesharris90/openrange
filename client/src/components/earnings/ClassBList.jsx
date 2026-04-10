import { memo, useMemo } from 'react';

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtPrice(value) {
  const n = toNum(value, null);
  if (n == null || n <= 0) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtMove(value) {
  const n = toNum(value, null);
  if (n == null || n <= 0) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtRvol(value) {
  const n = toNum(value, null);
  if (n == null || n <= 0) return '—';
  return `${n.toFixed(2)}x`;
}

function biasClass(bias) {
  const b = String(bias || '').toUpperCase();
  if (b === 'BULLISH') return 'text-green-400';
  if (b === 'BEARISH') return 'text-red-400';
  return 'text-gray-400';
}

function ClassBList({ data, onOpen }) {
  const rows = useMemo(
    () => [...(Array.isArray(data) ? data : [])].sort((a, b) => (toNum(b.score, 0) - toNum(a.score, 0))),
    [data],
  );

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-gray-700 bg-[#111827] p-4 text-sm text-gray-400">
        No Class B setups for this window.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <button
          key={`${row.day_key || row.report_date || 'na'}-${row.symbol}`}
          type="button"
          onClick={() => onOpen?.(row.symbol, row)}
          className="rounded-xl border border-gray-700 bg-[#111827] p-4 text-left transition hover:border-cyan-400/50 hover:bg-[#172033]"
        >
          <div className="flex items-center justify-between">
            <div className="text-xl font-semibold text-white">{row.symbol}</div>
            <div className="text-sm text-gray-300">{fmtPrice(row.price)}</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400">Expected Move</div>
              <div className="font-semibold text-white">{fmtMove(row.expected_move_percent)}</div>
            </div>
            <div>
              <div className="text-gray-400">RVOL</div>
              <div className="font-semibold text-white">{fmtRvol(row.rvol)}</div>
            </div>
          </div>

          <div className="mt-3 text-sm text-gray-300">
            <span className="text-gray-400">Setup: </span>
            <span className="font-medium text-white">{row.setup || 'Continuation / VWAP'}</span>
          </div>
          <div className="mt-1 text-sm">
            <span className="text-gray-400">Bias: </span>
            <span className={`font-semibold ${biasClass(row.bias)}`}>{row.bias || 'NEUTRAL'}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default memo(ClassBList);
