import { Link } from 'react-router-dom';

export default function TickerLink({ symbol, className = '' }) {
  const upper = String(symbol || '').toUpperCase();
  if (!upper) return <span className={className}>--</span>;

  return (
    <Link
      to={`/charts?symbol=${encodeURIComponent(upper)}`}
      className={`font-semibold text-[var(--accent-blue)] hover:underline ${className}`.trim()}
      title={`Open ${upper} chart`}
    >
      {upper}
    </Link>
  );
}
