import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Mail, RefreshCw, X } from 'lucide-react';
import { authFetch } from '../utils/api';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';

type IntelItem = {
  id: number;
  subject: string | null;
  from: string | null;
  source_tag: string;
  received_at: string;
  summary: string | null;
  sentiment_score: number | null;
  raw_text: string | null;
  processed: boolean;
};

const SOURCE_COLORS: Record<string, string> = {
  alert:      'bg-red-500/20 text-red-400',
  earnings:   'bg-amber-500/20 text-amber-400',
  analyst:    'bg-blue-500/20 text-blue-400',
  briefing:   'bg-purple-500/20 text-purple-400',
  newsletter: 'bg-green-500/20 text-green-400',
  general:    'bg-zinc-500/20 text-zinc-400',
  unknown:    'bg-zinc-500/20 text-zinc-400',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

function SourceBadge({ tag }: { tag: string }) {
  const cls = SOURCE_COLORS[tag] ?? SOURCE_COLORS.general;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {tag}
    </span>
  );
}

export default function IntelligencePage() {
  const navigate = useNavigate();
  const [items, setItems]       = useState<IntelItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selected, setSelected] = useState<IntelItem | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/intelligence/list');
      if (res.status === 401) { navigate('/login', { replace: true }); return; }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Failed to load');
      setItems(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  const markReviewed = async (id: number) => {
    setReviewing(true);
    try {
      const res = await authFetch(`/api/intelligence/${id}/reviewed`, { method: 'PATCH' });
      if (res.ok) {
        setItems(prev => prev.map(i => i.id === id ? { ...i, processed: true } : i));
        setSelected(prev => prev?.id === id ? { ...prev, processed: true } : prev);
      }
    } finally {
      setReviewing(false);
    }
  };

  return (
    <PageContainer>
      {/* Header card */}
      <div className="panel p-4">
        <PageHeader
          title="Intelligence Inbox"
          subtitle="Ingested email intelligence — briefings, alerts, and analyst notes."
          actions={
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          }
        />
      </div>

      {/* Table card */}
      <div className="panel overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center p-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-3 p-6 text-red-400">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-16 text-[var(--text-secondary)]">
            <Mail size={32} className="opacity-30" />
            <p className="text-sm">No intelligence items yet.</p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-left text-xs text-[var(--text-secondary)]">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Sentiment</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={`cursor-pointer border-b border-[var(--border-color)] transition-colors hover:bg-[var(--bg-card-hover)] ${
                      selected?.id === item.id ? 'bg-[rgba(74,158,255,0.08)]' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--text-secondary)]">
                      {formatDate(item.received_at)}
                    </td>
                    <td className="px-4 py-3">
                      <SourceBadge tag={item.source_tag} />
                    </td>
                    <td className="px-4 py-3 text-[var(--text-primary)]">
                      <span className={item.processed ? 'opacity-50' : ''}>
                        {item.subject ?? '(no subject)'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {item.sentiment_score != null ? item.sentiment_score.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {item.processed ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-500">
                          <CheckCircle size={12} /> Reviewed
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">Unread</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[var(--text-secondary)]">
                      View →
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setSelected(null)}
          />

          {/* Drawer panel */}
          <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl">
            {/* Drawer header */}
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div className="flex items-center gap-3">
                <SourceBadge tag={selected.source_tag} />
                <span className="text-xs text-[var(--text-secondary)]">
                  {formatDate(selected.received_at)}
                </span>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div>
                <p className="mb-1 text-xs text-[var(--text-secondary)]">Subject</p>
                <p className="font-medium text-[var(--text-primary)]">
                  {selected.subject ?? '(no subject)'}
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs text-[var(--text-secondary)]">From</p>
                <p className="text-[var(--text-primary)]">{selected.from ?? '—'}</p>
              </div>

              <div>
                <p className="mb-1 text-xs text-[var(--text-secondary)]">Summary</p>
                <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                  {selected.summary ?? (
                    <span className="text-[var(--text-secondary)]">No summary available.</span>
                  )}
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs text-[var(--text-secondary)]">Sentiment</p>
                <p className="text-sm text-[var(--text-secondary)]">
                  {selected.sentiment_score != null
                    ? `Score: ${selected.sentiment_score.toFixed(2)}`
                    : 'No sentiment data available.'}
                </p>
              </div>

              {selected.raw_text && (
                <div>
                  <p className="mb-2 text-xs text-[var(--text-secondary)]">Raw Content</p>
                  <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {selected.raw_text}
                  </pre>
                </div>
              )}
            </div>

            {/* Drawer footer */}
            <div className="border-t border-[var(--border-color)] px-5 py-4">
              <button
                onClick={() => markReviewed(selected.id)}
                disabled={selected.processed || reviewing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[rgba(74,158,255,0.15)] px-4 py-2 text-sm text-[var(--accent-blue)] transition-colors hover:bg-[rgba(74,158,255,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCircle size={16} />
                {selected.processed ? 'Already Reviewed' : reviewing ? 'Marking…' : 'Mark as Reviewed'}
              </button>
            </div>
          </aside>
        </>
      )}
    </PageContainer>
  );
}
