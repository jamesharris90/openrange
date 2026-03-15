import BasePillarShell from './BasePillarShell';

export default function TradingShell({ children, title = 'Trading Workspace', subtitle = 'Manual execution with intelligence overlays' }) {
  return <BasePillarShell title={title} subtitle={subtitle}>{children}</BasePillarShell>;
}
