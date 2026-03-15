import BasePillarShell from './BasePillarShell';

export default function SystemShell({ children, title = 'System Control', subtitle = 'Governance, diagnostics, and access control' }) {
  return <BasePillarShell title={title} subtitle={subtitle}>{children}</BasePillarShell>;
}
