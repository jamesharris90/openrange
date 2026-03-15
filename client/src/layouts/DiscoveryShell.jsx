import BasePillarShell from './BasePillarShell';

export default function DiscoveryShell({ children, title = 'Discovery', subtitle = 'Find high-quality stocks in play' }) {
  return <BasePillarShell title={title} subtitle={subtitle}>{children}</BasePillarShell>;
}
