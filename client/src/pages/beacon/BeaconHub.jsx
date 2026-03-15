import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';
import SignalCard from '../../components/cards/SignalCard';
import OpportunityCard from '../../components/cards/OpportunityCard';
import BeaconShell from '../../layouts/BeaconShell';

export default function BeaconHub() {
  const { data, isLoading } = useQuery({
    queryKey: ['beacon-hub'],
    queryFn: async () => {
      const [signals, opportunities] = await Promise.all([
        apiClient('/intelligence/trade-probability').catch(() => ({ items: [] })),
        apiClient('/opportunities?limit=12').catch(() => ({ items: [] })),
      ]);
      return {
        signals: signals?.items || signals?.signals || [],
        opportunities: opportunities?.items || [],
      };
    },
    refetchInterval: 30000,
  });

  return (
    <BeaconShell title="Beacon Intelligence Hub" subtitle="Machine-ranked opportunities with confidence context">
      {isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading Beacon intelligence...</div> : null}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(data?.signals || []).slice(0, 6).map((signal, idx) => <SignalCard key={`${signal.symbol || 's'}-${idx}`} signal={signal} />)}
      </section>
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {(data?.opportunities || []).slice(0, 6).map((item, idx) => <OpportunityCard key={`${item.symbol || 'o'}-${idx}`} item={item} />)}
      </section>
    </BeaconShell>
  );
}
