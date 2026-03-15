import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import TickerLink from '../components/shared/TickerLink';
import Table from '../components/ui/Table';
import FilterPanel from '../components/filters/FilterPanel';
import { useUnifiedFilters } from '../hooks/filters/useUnifiedFilters';
import useBeaconSignalMap from '../hooks/beacon/useBeaconSignalMap';
import BeaconSignalInline from '../components/beacon/BeaconSignalInline';
import useBeaconOverlayVisibility from '../hooks/beacon/useBeaconOverlayVisibility';
import BeaconOverlayStatusChip from '../components/beacon/BeaconOverlayStatusChip';

export default function ScreenerFull() {
  const { showBeaconSignals, toggleBeaconSignals } = useBeaconOverlayVisibility('scanner', true);
  const {
    filters,
    updateRange,
    updateMulti,
    clearFilters,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
    legacyQueryParams,
  } = useUnifiedFilters({ storageKey: 'openrange:screener-full:unified-filters' });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('relative_volume');
  const [sortDir, setSortDir] = useState('desc');

  const legacyPresets = {
    'Gap & Go': { gap_min: '5', rvol_min: '2', price_min: '1', strategy: 'Gap & Go' },
    'High RVOL': { rvol_min: '3' },
    Momentum: { price_min: '5', rvol_min: '1.5' },
    'Low Float': { price_max: '20', rvol_min: '2', gap_min: '3' },
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = legacyQueryParams.toString();
      const payload = await apiJSON(`/api/screener/full${query ? `?${query}` : ''}`);
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
    } catch (err) {
      setRows([]);
      setError(err?.message || 'Failed to load screener');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedRows = [...rows].sort((a, b) => {
    const av = Number(a?.[sortBy] ?? 0);
    const bv = Number(b?.[sortBy] ?? 0);
    if (sortDir === 'asc') return av - bv;
    return bv - av;
  });

  const visibleSymbols = useMemo(
    () => sortedRows.map((row) => row?.symbol).filter(Boolean).slice(0, 150),
    [sortedRows],
  );

  const { getSignal } = useBeaconSignalMap({
    symbols: visibleSymbols,
    enabled: showBeaconSignals,
    debounceMs: 300,
  });

  const activeBeaconSignals = useMemo(() => {
    if (!showBeaconSignals) return [];
    return sortedRows
      .map((row) => getSignal(row.symbol))
      .filter(Boolean)
      .slice(0, 6);
  }, [showBeaconSignals, sortedRows, getSignal]);
  const activeBeaconSymbolCount = showBeaconSignals ? activeBeaconSignals.length : 0;

  const onSort = (field) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(field);
    setSortDir('desc');
  };

  const applyPreset = (name) => {
    const preset = legacyPresets[name] || {};
    if (preset.price_min || preset.price_max) updateRange('price', { min: preset.price_min || '', max: preset.price_max || '' });
    if (preset.rvol_min || preset.rvol_max) updateRange('relativeVolume', { min: preset.rvol_min || '', max: preset.rvol_max || '' });
    if (preset.gap_min || preset.gap_max) updateRange('gapPercent', { min: preset.gap_min || '', max: preset.gap_max || '' });
    if (preset.market_cap || preset.market_cap_min || preset.market_cap_max) updateRange('marketCap', {
      min: preset.market_cap_min || preset.market_cap || '',
      max: preset.market_cap_max || '',
    });
    if (preset.sector) updateMulti('sector', [preset.sector]);
  };

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Manual Universe Screener"
          subtitle="Filter the full tradable universe with trader controls."
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Saved Presets</span>
          {Object.keys(legacyPresets)?.map((name) => (
            <button key={name} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs" onClick={() => applyPreset(name)}>{name}</button>
          ))}
        </div>
        <div className="mt-3">
          <FilterPanel
            filters={filters}
            updateRange={updateRange}
            updateMulti={updateMulti}
            clearFilters={clearFilters}
            presets={presets}
            savePreset={savePreset}
            loadPreset={loadPreset}
            deletePreset={deletePreset}
          />
        </div>
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={load}>Apply Filters</button>
            <button type="button" className="btn-secondary" onClick={toggleBeaconSignals}>
              {showBeaconSignals ? 'Hide Beacon Signals' : 'Show Beacon Signals'}
            </button>
            <BeaconOverlayStatusChip isEnabled={showBeaconSignals} activeSymbols={activeBeaconSymbolCount} />
          </div>
        </div>
      </Card>

      {showBeaconSignals && activeBeaconSignals.length ? (
        <Card>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Beacon Overlays</div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {activeBeaconSignals.map((signal, idx) => (
              <BeaconSignalInline key={`${signal.symbol}-${idx}`} signal={signal} title={`Beacon Overlay • ${signal.symbol}`} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        {loading ? (
          <LoadingSpinner message="Loading full screener…" />
        ) : error ? (
          <div className="muted">{error}</div>
        ) : rows.length === 0 ? (
          <div className="muted">No symbols match current filters.</div>
        ) : (
          <Table>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Change %</th>
                <th style={{ textAlign: 'right' }}>Gap %</th>
                <th style={{ textAlign: 'right' }}>RVol</th>
                <th>Sector</th>
                <th>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows?.map((row) => (
                <tr key={row?.symbol}>
                  <td><TickerLink symbol={row?.symbol} /></td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.price || 0).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.change_percent || 0).toFixed(2)}%</td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.gap_percent || 0).toFixed(2)}%</td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                  <td>{row?.sector || '--'}</td>
                  <td>{row?.strategy || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </Table>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-[var(--text-muted)]">Sort:</span>
          <button className="rounded border border-[var(--border-color)] px-2 py-1" onClick={() => onSort('relative_volume')}>RVol</button>
          <button className="rounded border border-[var(--border-color)] px-2 py-1" onClick={() => onSort('gap_percent')}>Gap</button>
          <button className="rounded border border-[var(--border-color)] px-2 py-1" onClick={() => onSort('change_percent')}>Change</button>
          <span className="text-[var(--text-secondary)]">{sortBy} ({sortDir})</span>
        </div>
      </Card>
    </PageContainer>
  );
}
