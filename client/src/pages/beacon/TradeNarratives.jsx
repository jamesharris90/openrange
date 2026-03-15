import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';
import NewsCatalystCard from '../../components/cards/NewsCatalystCard';
import BeaconShell from '../../layouts/BeaconShell';

export default function TradeNarratives() {
  const { data, isLoading } = useQuery({
    queryKey: ['beacon-trade-narratives'],
    queryFn: async () => {
      const [narrative, fallback] = await Promise.all([
        apiClient('/intelligence/market-narrative').catch(() => null),
        apiClient('/market-narrative').catch(() => null),
      ]);
      const narrativeItems = [];
      if (narrative) narrativeItems.push({ symbol: 'INTEL', headline: narrative.summary || narrative.narrative || 'Intelligence narrative', catalyst_type: 'market', sentiment: narrative.bias || 'neutral' });
      if (fallback) narrativeItems.push({ symbol: 'MARKET', headline: fallback.summary || fallback.narrative || 'Market narrative', catalyst_type: 'context', sentiment: fallback.bias || 'neutral' });
      return narrativeItems;
    },
    refetchInterval: 45000,
  });

  return (
    <BeaconShell title="Trade Narratives" subtitle="Narrative context from live intelligence endpoints">
      {isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading narratives...</div> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(data || []).map((item, idx) => <NewsCatalystCard key={`${item.symbol || 'n'}-${idx}`} item={item} />)}
      </div>
    </BeaconShell>
  );
}
