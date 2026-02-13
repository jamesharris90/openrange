// Shared cell render helpers to keep tables consistent
import React from 'react';
import { formatCurrency, formatPercent, formatMarketCap, formatVolume } from './formatters';
import { EARNINGS_TIME_LABELS, EARNINGS_TIME_COLORS } from './constants';

export const renderSymbolLink = (symbol, onClick) => (
  <span className="text-link" onClick={() => onClick?.(symbol)}>{symbol}</span>
);

export const renderPrice = (value) => formatCurrency(value);

export const renderPercentColor = (value) => {
  if (value == null) return '--';
  const positive = value >= 0;
  return (
    <span className={positive ? 'text-positive' : 'text-negative'}>
      {formatPercent(value)}
    </span>
  );
};

export const renderMarketCapCell = (val) => formatMarketCap(val);
export const renderVolumeCell = (val) => formatVolume(val);

export const renderTimeBadge = (hour) => {
  const colors = EARNINGS_TIME_COLORS[hour] || {};
  return (
    <span className="time-badge" style={{ background: colors.bg, color: colors.color }}>
      {EARNINGS_TIME_LABELS[hour] || hour || '--'}
    </span>
  );
};

export const renderRvol = (rvol) => {
  if (rvol == null) return '--';
  const className = rvol >= 3 ? 'text-positive strong' : rvol >= 1.5 ? 'text-warning strong' : 'text-muted';
  return <span className={className}>{rvol.toFixed(1)}x</span>;
};

export const renderShortPercent = (val) => {
  if (val == null) return '--';
  const className = val >= 20 ? 'text-negative' : val >= 10 ? 'text-warning' : 'text-muted';
  return <span className={className}>{val.toFixed(1)}%</span>;
};

export const renderDistPercent = (val) => {
  if (val == null) return '--';
  const className = val >= 0 ? 'text-positive' : 'text-negative';
  return <span className={className}>{formatPercent(val)}</span>;
};
