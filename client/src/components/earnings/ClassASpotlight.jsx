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

function fmtScore(value) {
  const n = toNum(value, null);
  if (n == null) return '—';
  return n.toFixed(1);
}

function moveWidth(expectedMove) {
  const move = toNum(expectedMove, 0);
  if (move <= 0) return 0;
  return Math.max(6, Math.min(100, (move / 12) * 100));
}

function biasFillClass(bias) {
  if (String(bias || '').toUpperCase() === 'BEARISH') return 'bg-red-400';
  return 'bg-green-400';
}

function ClassASpotlight({ data, onOpen }) {
  const spotlightRows = useMemo(
    () => [...(Array.isArray(data) ? data : [])].sort((a, b) => (toNum(b.score, 0) - toNum(a.score, 0))),
    [data],
  );

  if (!spotlightRows.length) {
    return (
      <div className="rounded-2xl border border-gray-700 bg-[#111827] p-6 text-sm text-gray-300">
        No high-quality earnings setups right now — monitor Class B or wait for market open.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {spotlightRows.map((row) => {
        const width = moveWidth(row.expected_move_percent);
        const fill = biasFillClass(row.bias);

        return (
          <button
            key={`${row.day_key || row.report_date || 'na'}-${row.symbol}`}
            type="button"
            onClick={() => onOpen?.(row.symbol, row)}
            className="w-full min-h-[180px] rounded-2xl border border-green-500/30 bg-gradient-to-br from-[#0b1220] via-[#111827] to-[#1a2538] p-5 text-left shadow-lg shadow-green-500/10 transition duration-200 hover:scale-[1.02] hover:shadow-green-400/25"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-3xl font-bold text-white">{row.symbol}</div>
                <div className="mt-1 text-xl font-semibold text-gray-200">{fmtPrice(row.price)}</div>
              </div>
              <span className="rounded-full border border-green-400/50 bg-green-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-green-300">
                Class A
              </span>
            </div>

            <div className="mt-4 grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-7">
                <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>Expected Move</span>
                  <span className="font-semibold text-white">{fmtMove(row.expected_move_percent)}</span>
                </div>
                <div className="h-3 w-full rounded-full bg-gray-800">
                  <div className={`h-3 rounded-full ${fill}`} style={{ width: `${width}%` }} />
                </div>
              </div>
              <div className="col-span-6 md:col-span-2">
                <div className="text-xs text-gray-400">RVOL</div>
                <div className="text-lg font-semibold text-green-300">{fmtRvol(row.rvol)}</div>
              </div>
              <div className="col-span-6 md:col-span-3">
                <div className="text-xs text-gray-400">Score</div>
                <div className="text-lg font-semibold text-white">{fmtScore(row.score)}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              <p className="text-sm text-gray-200">
                <span className="font-semibold text-white">Why Moving: </span>
                {row.why_moving || row.trade_reason || 'Catalyst context pending'}
              </p>
              <p className="text-sm text-gray-200">
                <span className="font-semibold text-white">Why Tradeable: </span>
                {row.why_tradeable || row.setup || 'Participation + move profile'}
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-400">Execution Plan</div>
              <div className="mt-1 text-sm font-semibold text-white">
                {row.execution_plan || 'Wait for confirmation'}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default memo(ClassASpotlight);
