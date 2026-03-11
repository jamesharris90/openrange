import React, { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import MarketCard from '../components/MarketCard';

export default function OpenMarketPage() {
  const [rows, setRows] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [sortBy, setSortBy] = useState('score');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadScanner() {
      setLoading(true);
      setError('');
      try {
        const payload = await apiJSON('/api/scanner');
        if (cancelled) return;
        setRows(Array.isArray(payload) ? payload : []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load open market opportunities');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadScanner();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedRows = useMemo(() => {
    const scoreValue = (row) => Number(row?.setup_score ?? row?.score ?? 0);
    const rvolValue = (row) => Number(row?.relative_volume ?? 0);
    const gapValue = (row) => Number(row?.gap_percent ?? 0);

    return [...rows].sort((a, b) => {
      if (sortBy === 'relativeVolume') return rvolValue(b) - rvolValue(a);
      if (sortBy === 'gap') return gapValue(b) - gapValue(a);
      return scoreValue(b) - scoreValue(a);
    });
  }, [rows, sortBy]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Open Market Board"
          subtitle="Engine-driven opportunity stream from scanner intelligence."
        />
        <div className="mt-3 flex items-center gap-2">
          <label className="muted" htmlFor="open-market-sort">Sort by</label>
          <select
            id="open-market-sort"
            className="input-field"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="score">Score</option>
            <option value="relativeVolume">Relative Volume</option>
            <option value="gap">Gap</option>
          </select>
        </div>
      </Card>

      {loading && <LoadingSpinner message="Loading open market opportunities…" />}
      {!loading && error && <Card><div className="muted">{error}</div></Card>}

      {!loading && !error && (
        <Card>
          {sortedRows.length === 0 ? (
            <div className="muted">No scanner opportunities available.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table data-table--compact min-w-[820px]">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th style={{ textAlign: 'right' }}>Price</th>
                    <th style={{ textAlign: 'right' }}>Change</th>
                    <th style={{ textAlign: 'right' }}>RVol</th>
                    <th>Sector</th>
                    <th>Setup Type</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows?.map((row) => {
                    const symbol = String(row?.symbol || '').toUpperCase();
                    return (
                      <tr
                        key={`${symbol}-${row?.setup || row?.setup_type || ''}`}
                        onClick={() => setSelectedSymbol(symbol)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ fontWeight: 700 }}>{symbol || '--'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(row?.price || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>{Number(row?.gap_percent || 0).toFixed(2)}%</td>
                        <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                        <td>{row?.sector || '--'}</td>
                        <td>{row?.setup_type || row?.setup || '--'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(row?.setup_score || row?.score || 0).toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        {selectedSymbol ? (
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>{selectedSymbol} context</div>
            <MarketCard symbol={selectedSymbol} />
          </div>
        ) : (
          <div className="muted">Select a scanner symbol to load market context.</div>
        )}
      </Card>
    </PageContainer>
  );
}
