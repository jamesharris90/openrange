import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'ok' || value === 'healthy' || value === 'green') return 'healthy';
  if (value === 'warning' || value === 'warn' || value === 'degraded' || value === 'yellow') return 'warning';
  if (value === 'error' || value === 'failed' || value === 'critical' || value === 'red') return 'failure';
  return 'unknown';
}

export default function HealthIndicator({ status, label }) {
  const normalized = normalizeStatus(status);

  const config = {
    healthy: {
      icon: CheckCircle2,
      className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      text: 'Healthy',
    },
    warning: {
      icon: AlertTriangle,
      className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      text: 'Warning',
    },
    failure: {
      icon: XCircle,
      className: 'border-red-500/40 bg-red-500/10 text-red-300',
      text: 'Failure',
    },
    unknown: {
      icon: AlertTriangle,
      className: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
      text: 'Unknown',
    },
  }[normalized];

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}>
      <Icon size={14} />
      {label || config.text}
    </span>
  );
}
