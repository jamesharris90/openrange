import { Link } from 'react-router-dom';
import { useSymbol } from '../../context/SymbolContext';

export default function TickerLink({ symbol, className = '' }) {
  const { setSelectedSymbol } = useSymbol();
  const upper = String(symbol || '').toUpperCase();
  if (!upper) return <span className={className}>--</span>;

  return (
    <Link
      to={`/charts?symbol=${encodeURIComponent(upper)}`}
      onClick={() => setSelectedSymbol(upper)}
      className={`font-semibold text-[var(--accent-blue)] hover:underline ${className}`.trim()}
      title={`Open ${upper} chart`}
    >
      {upper}
    </Link>
  );
}
