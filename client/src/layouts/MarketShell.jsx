import BasePillarShell from './BasePillarShell';

export default function MarketShell({ children, title = 'Market Context', subtitle = 'Regime, breadth, and sector conditions' }) {
  return <BasePillarShell title={title} subtitle={subtitle}>{children}</BasePillarShell>;
}
