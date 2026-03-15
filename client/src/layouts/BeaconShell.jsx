import BasePillarShell from './BasePillarShell';

export default function BeaconShell({ children, title = 'Beacon Intelligence Engine', subtitle = 'Signal confidence, probabilities, and narrative context' }) {
  return <BasePillarShell title={title} subtitle={subtitle}>{children}</BasePillarShell>;
}
