import BasePillarShell from './BasePillarShell';

export default function LearningShell({ children, title = 'Strategy Learning', subtitle = 'Calibration, edge, and performance feedback loops' }) {
  return <BasePillarShell title={title} subtitle={subtitle}>{children}</BasePillarShell>;
}
