import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Mail, RefreshCw } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import IntelDetailPanel from '../components/intelligence/IntelDetailPanel';

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
  const { logout } = useAuth();
  const [items, setItems]       = useState<IntelItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selected, setSelected] = useState<IntelItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [intelDetail, setIntelDetail] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/intelligence/list');

      if (res.status === 401) { logout(); navigate('/login', { replace: true }); return; }
      if (res.status === 403) { setError('Forbidden — you do not have access to this resource.'); return; }
      if (!res.ok) { setError(`Server error (${res.status}) — please try again later.`); return; }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Failed to load');
      setItems(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [navigate, logout]);

  useEffect(() => { load(); }, [load]);

  const openIntelPanel = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await authFetch(`/api/intel/details/${id}`);
      if (!res.ok) throw new Error(`Failed to load intel detail (${res.status})`);
      const data = await res.json();
      setIntelDetail(data || null);
    } catch {
      setIntelDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

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
                    onClick={() => {
                      setSelected(item);
                      openIntelPanel(item.id);
                    }}
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

      <IntelDetailPanel
        open={detailOpen}
        detail={detailLoading ? { title: 'Loading intelligence detail...' } : intelDetail}
        onClose={() => setDetailOpen(false)}
        onOpenSetup={() => navigate('/strategy-evaluation')}
      />
    </PageContainer>
  );
}
