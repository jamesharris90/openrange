import { useEffect, useRef } from 'react';

export default function TradingViewProfile({ symbol, height = 400 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!symbol || !containerRef.current) return;
    containerRef.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-profile.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      width: '100%',
      height: height,
      isTransparent: true,
      colorTheme: 'dark',
      symbol: symbol,
      locale: 'en',
    });
    containerRef.current.appendChild(script);
  }, [symbol, height]);

  return <div ref={containerRef} style={{ height, width: '100%' }} />;
}
