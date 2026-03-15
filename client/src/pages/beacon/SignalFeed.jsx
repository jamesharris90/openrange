import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';
import SignalCard from '../../components/cards/SignalCard';
import BeaconShell from '../../layouts/BeaconShell';

export default function SignalFeed() {
  const [compactMode, setCompactMode] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['beacon-signal-feed'],
    queryFn: async () => {
      const [flow, squeezes] = await Promise.all([
        apiClient('/intelligence/flow?limit=60').catch(() => ({ items: [] })),
        apiClient('/intelligence/squeezes?limit=60').catch(() => ({ items: [] })),
      ]);
      return [...(flow?.items || []), ...(squeezes?.items || [])];
    },
    refetchInterval: 20000,
  });

  return (
    <BeaconShell title="Signal Feed" subtitle="Flow, squeeze, and setup signals">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setCompactMode((current) => !current)}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
        >
          {compactMode ? 'Card Mode' : 'Compact Table Mode'}
        </button>
      </div>
      {isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading signal feed...</div> : null}
      {!compactMode ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(data || []).map((signal, idx) => <SignalCard key={`${signal.symbol || 'sig'}-${idx}`} signal={signal} />)}
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
                {(data || []).map((signal, idx) => (
                  <tr key={`${signal.symbol || 'sig'}-${idx}`} className="border-t border-slate-800">
                    <td className="px-2 py-1 text-slate-100">{signal.symbol || '--'}</td>
                    <td className="px-2 py-1">{Number(signal.confidence ?? signal.score ?? 0).toFixed(1)}</td>
                    <td className="px-2 py-1">{signal.expected_move ?? signal.expectedMove ?? '--'}</td>
                    <td className="px-2 py-1">{signal.catalyst_summary ?? signal.catalyst ?? '--'}</td>
                    <td className="px-2 py-1">{signal.sector_context ?? signal.sector ?? '--'}</td>
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
