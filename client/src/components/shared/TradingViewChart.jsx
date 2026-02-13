import { useEffect, useRef, useId } from 'react';

export default function TradingViewChart({ symbol, height = 500, interval = '15', range, hideSideToolbar = false, studies }) {
  const containerRef = useRef(null);
  const stableId = useId().replace(/:/g, '-');
  const id = `tv-chart-${stableId}`;

  useEffect(() => {
    if (!symbol || !containerRef.current || typeof TradingView === 'undefined') return;
    try {
      containerRef.current.innerHTML = '';
      const config = {
        autosize: true,
        symbol: symbol,
        interval: interval,
        timezone: 'America/New_York',
        theme: 'dark',
        style: '1',
        locale: 'en',
        toolbar_bg: '#0a0e1a',
        enable_publishing: false,
        allow_symbol_change: true,
        container_id: containerRef.current.id,
        studies: studies || ['MASimple@tv-basicstudies', 'VWAP@tv-basicstudies', 'Volume@tv-basicstudies'],
        hide_side_toolbar: hideSideToolbar,
        withdateranges: true,
      };
      if (range) config.range = range;
      new TradingView.widget(config);
    } catch (err) {
      console.warn('TradingView widget failed to initialize:', err);
    }
  }, [symbol, interval]);

  return (
    <div
      id={id}
      ref={containerRef}
      style={{ height, width: '100%', borderRadius: 'var(--border-radius)', overflow: 'hidden' }}
    />
  );
}
