import { useMemo, useState } from 'react';

const LOGO_KEY = import.meta.env.VITE_LOGO_DEV_KEY;
const FALLBACK_LOGO = '/logos/default.svg';

export default function TickerLogo({ symbol, className = '' }) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const [useFallback, setUseFallback] = useState(false);

  const src = useMemo(() => {
    if (useFallback || !normalizedSymbol || !LOGO_KEY) {
      return FALLBACK_LOGO;
    }
    return `https://img.logo.dev/ticker/${normalizedSymbol}?token=${LOGO_KEY}`;
  }, [normalizedSymbol, useFallback]);

  return (
    <div className={`ticker-logo ${className}`.trim()}>
      <img
        src={src}
        alt={`${normalizedSymbol || 'Ticker'} logo`}
        className="ticker-logo__img"
        loading="lazy"
        onError={() => {
          if (!useFallback) setUseFallback(true);
        }}
      />
    </div>
  );
}
