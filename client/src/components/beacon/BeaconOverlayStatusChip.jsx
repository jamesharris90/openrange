export default function BeaconOverlayStatusChip({ isEnabled, activeSymbols = 0, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs ${className}`.trim()}>
      <span className="text-blue-400">Beacon Signals: {isEnabled ? 'ON' : 'OFF'}</span>
      <span className="text-slate-300">Active Symbols: {activeSymbols}</span>
    </div>
  );
}