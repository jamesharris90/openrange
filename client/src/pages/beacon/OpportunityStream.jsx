import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';
import OpportunityCard from '../../components/cards/OpportunityCard';
import BeaconShell from '../../layouts/BeaconShell';

export default function OpportunityStream() {
  const [compactMode, setCompactMode] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['beacon-opportunity-stream'],
    queryFn: async () => {
      const payload = await apiClient('/opportunity-stream').catch(() => ({ items: [] }));
      return payload?.items || payload || [];
    },
    refetchInterval: 20000,
  });

  return (
    <BeaconShell title="Opportunity Stream" subtitle="Live high-probability opportunities">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setCompactMode((current) => !current)}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
        >
          {compactMode ? 'Card Mode' : 'Compact Table Mode'}
        </button>
      </div>
      {isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading opportunities...</div> : null}
      {!compactMode ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {(data || []).map((item, idx) => <OpportunityCard key={`${item.symbol || 'op'}-${idx}`} item={item} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-slate-300">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="px-2 py-1">Symbol</th>
                  <th className="px-2 py-1">Confidence</th>
                  <th className="px-2 py-1">Expected Move</th>
                  <th className="px-2 py-1">Catalyst</th>
                  <th className="px-2 py-1">Sector</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((item, idx) => (
                  <tr key={`${item.symbol || 'op'}-${idx}`} className="border-t border-slate-800">
                    <td className="px-2 py-1 text-slate-100">{item.symbol || '--'}</td>
                    <td className="px-2 py-1">{Number(item.confidence ?? item.score ?? 0).toFixed(2)}</td>
                    <td className="px-2 py-1">{item.expected_move ?? item.expectedMove ?? '--'}</td>
                    <td className="px-2 py-1">{item.catalyst_summary ?? item.catalyst ?? '--'}</td>
                    <td className="px-2 py-1">{item.sector_context ?? item.sector ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </BeaconShell>
  );
}
