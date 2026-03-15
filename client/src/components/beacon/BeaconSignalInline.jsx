import SignalCard from '../cards/SignalCard';

export default function BeaconSignalInline({ signal, title = 'Active Beacon Signal' }) {
  if (!signal) return null;

  return (
    <div className="rounded-xl border border-blue-500/20 bg-slate-950/80 p-2">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-blue-400">{title}</p>
      <SignalCard signal={signal} />
    </div>
  );
}
