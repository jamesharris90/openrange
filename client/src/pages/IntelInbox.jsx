import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import SkeletonCard from '../components/ui/SkeletonCard';
import { apiJSON } from '../api/apiClient';
import TickerLink from '../components/shared/TickerLink';
import MiniSymbolChart from '../components/charts/MiniSymbolChart';
import IntelDetailPanel from '../components/intelligence/IntelDetailPanel';
import { useNavigate } from 'react-router-dom';

export default function IntelInbox() {
  const navigate = useNavigate();
  const [selectedSymbol, setSelectedSymbol] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [narratives, setNarratives] = useState([]);
  const [signals, setSignals] = useState([]);
  const [narrativeRegime, setNarrativeRegime] = useState('Neutral');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        let url = '/api/intelligence/news?hours=24';
        if (selectedSymbol && selectedSymbol !== 'ALL') {
          url += `&symbol=${encodeURIComponent(selectedSymbol)}`;
        }
        const payload = await apiJSON(url);
        if (!cancelled) setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadNarratives() {
      try {
        const payload = await apiJSON('/api/narratives/latest');
        if (cancelled) return;
        setNarratives(Array.isArray(payload?.items) ? payload.items : []);
        setNarrativeRegime(String(payload?.regime || 'Neutral'));
      } catch {
        if (!cancelled) {
          setNarratives([]);
          setNarrativeRegime('Neutral');
        }
      }
    }

    loadNarratives();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSignals() {
      try {
        const payload = await apiJSON('/api/opportunities/top?limit=8');
        if (cancelled) return;
        setSignals(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!cancelled) setSignals([]);
      }
    }

    loadSignals();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openIntelPanel(token) {
    try {
      const payload = await apiJSON(`/api/intel/details/${encodeURIComponent(token)}`);
      setDetailData(payload || null);
      setDetailOpen(true);
    } catch {
      setDetailData(null);
      setDetailOpen(true);
    }
  }

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Intel Inbox"
          subtitle={`Filtered intelligence news feed with sentiment and sector context for ${selectedSymbol}.`}
        />
      </Card>

      <Card>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="intel-symbol-filter" className="muted">Symbol filter:</label>
          <select
            id="intel-symbol-filter"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(String(e.target.value || 'ALL').toUpperCase())}
            className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1"
          >
            <option value="ALL">ALL</option>
            <option value="SPY">SPY</option>
            <option value="QQQ">QQQ</option>
            <option value="IWM">IWM</option>
            <option value="DIA">DIA</option>
          </select>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm">Narrative Commentary</h3>
          <span className="muted text-xs">Regime: {narrativeRegime}</span>
        </div>
        {narratives.length === 0 ? (
          <div className="muted text-sm">No narrative intelligence available.</div>
        ) : (
          <div className="space-y-2">
            {narratives.slice(0, 6).map((row, idx) => (
              <button
                key={`${row?.sector || 's'}-${idx}`}
                type="button"
                onClick={() => openIntelPanel(`sector:${String(row?.sector || 'market').toLowerCase()}`)}
                className="w-full rounded border border-[var(--border-color)] p-2 text-left text-sm hover:bg-[var(--bg-card-hover)]"
              >
                <div className="flex items-center justify-between">
                  <strong>{row?.sector || 'Market'}</strong>
                  <span className="muted text-xs">Confidence {Number(row?.confidence || 0).toFixed(2)}</span>
                </div>
                <div className="mt-1">{row?.narrative || '--'}</div>
                <div className="muted mt-1 text-xs">
                  Affected: {Array.isArray(row?.affected_symbols) && row.affected_symbols.length ? row.affected_symbols.join(', ') : 'N/A'}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm">Signal Items</h3>
          <span className="muted text-xs">Click for full intelligence detail</span>
        </div>
        {!signals.length ? (
          <div className="muted text-sm">No active signal items right now.</div>
        ) : (
          <div className="space-y-2">
            {signals.map((row, idx) => (
              <button
                key={`${row?.symbol || 'sig'}-${idx}`}
                type="button"
                onClick={() => openIntelPanel(`signal:${String(row?.symbol || '').toUpperCase()}`)}
                className="w-full rounded border border-[var(--border-color)] p-2 text-left hover:bg-[var(--bg-card-hover)]"
              >
                <div className="flex items-center justify-between">
                  <strong>{row?.symbol || '--'}</strong>
                  <span className="muted text-xs">Score {Number(row?.score || 0).toFixed(2)}</span>
                </div>
                <div className="muted text-xs">{row?.strategy || 'Setup'} • {row?.confidence || 'N/A'}</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        {loading ? (
          <div className="grid gap-2">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        ) : items.length === 0 ? (
          <div className="muted">No intelligence yet</div>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <button
                key={`${item?.url || 'n'}-${index}`}
                onClick={() => openIntelPanel(item?.id || `news:${String(item?.symbol || 'MARKET').toUpperCase()}`)}
                className="block w-full rounded border border-[var(--border-color)] p-2 text-left text-sm hover:bg-[var(--bg-card-hover)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <TickerLink symbol={String(item?.symbol || 'MARKET').toUpperCase()} />
                  <span className="muted">{item?.sentiment || 'neutral'}</span>
                </div>
                <div>{item?.headline || '--'}</div>
                <div className="muted text-xs">{item?.sector || 'Unknown sector'} • {item?.source_name || item?.source || 'Unknown source'}</div>
                <div className="mt-1">
                  <MiniSymbolChart symbol={String(item?.symbol || '').toUpperCase()} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <IntelDetailPanel
        open={detailOpen}
        detail={detailData}
        onClose={() => setDetailOpen(false)}
        onOpenSetup={() => navigate('/strategy-evaluation')}
      />
    </PageContainer>
  );
}
