// Shared filter schema definitions used across pages
(function (global) {
  const sections = {
    liquidity: {
      id: 'liquidity',
      title: 'Liquidity',
      fields: [
        { id: 'priceMin', label: 'Price Min', type: 'number', min: 0, step: 0.01, placeholder: 'e.g. 1' },
        { id: 'priceMax', label: 'Price Max', type: 'number', min: 0, step: 0.01, placeholder: 'e.g. 200' },
        { id: 'marketCap', label: 'Market Cap', type: 'select', options: [
          { value: '', label: 'Any' },
          { value: 'micro', label: 'Micro (<$300M)' },
          { value: 'small', label: 'Small ($300M-$2B)' },
          { value: 'mid', label: 'Mid ($2B-$10B)' },
          { value: 'large', label: 'Large ($10B-$200B)' },
          { value: 'mega', label: 'Mega (>$200B)' },
        ] },
        { id: 'marketCapMin', label: 'Market Cap Min ($M)', type: 'number', min: 0, step: 10 },
        { id: 'marketCapMax', label: 'Market Cap Max ($M)', type: 'number', min: 0, step: 10 },
        { id: 'floatMin', label: 'Float Min (M)', type: 'number', min: 0, step: 0.1 },
        { id: 'floatMax', label: 'Float Max (M)', type: 'number', min: 0, step: 0.1 },
        { id: 'avgVolume', label: 'Avg Volume Min', type: 'number', min: 0, step: 1000 },
        { id: 'volumeMin', label: 'Current Volume Min', type: 'number', min: 0, step: 1000 },
        { id: 'relVolMin', label: 'Relative Volume Min', type: 'slider', min: 0, max: 10, step: 0.1, format: (v) => `${v}x` },
        { id: 'dollarVolMin', label: 'Dollar Volume Min ($)', type: 'number', min: 0, step: 100000 },
        { id: 'spreadPctMax', label: 'Spread % Max', type: 'number', min: 0, step: 0.1 },
        { id: 'floatRotation', label: 'Float Rotation %', type: 'number', min: 0, step: 1 },
      ],
    },
    volatility: {
      id: 'volatility',
      title: 'Volatility',
      fields: [
        { id: 'changeMin', label: '% Change Today Min', type: 'slider', min: 0, max: 30, step: 0.5, format: (v) => `${v}%` },
        { id: 'premarketChangeMin', label: 'Premarket % Min', type: 'slider', min: 0, max: 20, step: 0.5, format: (v) => `${v}%` },
        { id: 'gapMin', label: 'Gap % Min', type: 'slider', min: 0, max: 30, step: 0.5, format: (v) => `${v}%` },
        { id: 'rangePct', label: 'Premarket Range %', type: 'number', min: 0, step: 0.5 },
        { id: 'atrPct', label: 'ATR % of Price', type: 'number', min: 0, step: 0.1 },
        { id: 'change3d', label: '3-Day % Change', type: 'slider', min: 0, max: 60, step: 1, format: (v) => `${v}%` },
        { id: 'change5d', label: '5-Day % Change', type: 'slider', min: 0, max: 80, step: 1, format: (v) => `${v}%` },
        { id: 'greenRedStreak', label: 'Consecutive Green/Red Days', type: 'select', options: [
          { value: '', label: 'Any' },
          { value: 'green2', label: '≥2 Green' },
          { value: 'green3', label: '≥3 Green' },
          { value: 'red2', label: '≥2 Red' },
          { value: 'red3', label: '≥3 Red' },
        ] },
        { id: 'insideDay', label: 'Inside Day', type: 'toggle' },
        { id: 'outsideDay', label: 'Outside Day', type: 'toggle' },
      ],
    },
    structure: {
      id: 'structure',
      title: 'Structure',
      fields: [
        { id: 'aboveSMA20', label: 'Above SMA 20', type: 'toggle' },
        { id: 'aboveSMA50', label: 'Above SMA 50', type: 'toggle' },
        { id: 'aboveSMA200', label: 'Above SMA 200', type: 'toggle' },
        { id: 'distVWAP', label: 'Distance from VWAP', type: 'slider', min: 0, max: 10, step: 0.25, format: (v) => `${v}%` },
        { id: 'dist52wHigh', label: 'Distance from 52W High', type: 'slider', min: 0, max: 10, step: 1, format: (v) => `${v}%` },
        { id: 'dist52wLow', label: 'Distance from 52W Low', type: 'slider', min: 0, max: 100, step: 1, format: (v) => `${v}%` },
        { id: 'higherHigh', label: 'Higher High Structure', type: 'toggle' },
        { id: 'higherLow', label: 'Higher Low Structure', type: 'toggle' },
        { id: 'brokeHOD', label: 'Break of High of Day', type: 'toggle' },
        { id: 'brokeLOD', label: 'Break of Low of Day', type: 'toggle' },
      ],
    },
    catalyst: {
      id: 'catalyst',
      title: 'Catalyst',
      fields: [
        { id: 'newsFreshness', label: 'News Freshness', type: 'select', options: [
          { value: '', label: 'Any time' },
          { value: 'breaking', label: 'Breaking (<1h)' },
          { value: 'fresh1h', label: '1-2h' },
          { value: 'today', label: 'Today' },
          { value: '24h', label: 'Last 24h' },
          { value: '48h', label: 'Last 48h' },
          { value: 'week', label: 'This week' },
        ] },
        { id: 'earningsTiming', label: 'Earnings Timing', type: 'select', options: [
          { value: '', label: 'Any' },
          { value: 'bmo', label: 'Pre-Market' },
          { value: 'amc', label: 'After Hours' },
          { value: 'upcoming', label: 'Upcoming' },
        ] },
        { id: 'earningsResult', label: 'Last Earnings Result', type: 'select', options: [
          { value: '', label: 'Any' },
          { value: 'beat', label: 'Beat' },
          { value: 'miss', label: 'Miss' },
          { value: 'inline', label: 'In-line' },
        ] },
        { id: 'newsType', label: 'News Type', type: 'multi', options: [
          { value: 'earnings', label: 'Earnings' },
          { value: 'guidance', label: 'Guidance' },
          { value: 'upgrade', label: 'Upgrade/Downgrade' },
          { value: 'contract', label: 'Contracts' },
          { value: 'fda', label: 'FDA/Clinical' },
          { value: 'ma', label: 'M&A' },
          { value: 'insider', label: 'Insider' },
          { value: 'rumor', label: 'Rumor' },
          { value: 'macro', label: 'Macro' },
        ] },
        { id: 'sentimentScore', label: 'Sentiment Score', type: 'slider', min: 0, max: 1, step: 0.05, format: (v) => v },
        { id: 'analystRating', label: 'Analyst Rating', type: 'select', options: [
          { value: '', label: 'Any' },
          { value: 'strong-buy', label: 'Strong Buy' },
          { value: 'buy', label: 'Buy' },
          { value: 'hold', label: 'Hold' },
          { value: 'sell', label: 'Sell' },
        ] },
        { id: 'guidance', label: 'Guidance', type: 'select', options: [
          { value: '', label: 'Any' },
          { value: 'raised', label: 'Raised' },
          { value: 'lowered', label: 'Lowered' },
        ] },
        { id: 'surprisePct', label: 'Surprise %', type: 'number', step: 0.1 },
      ],
    },
    squeeze: {
      id: 'squeeze',
      title: 'Short Interest / Squeeze',
      fields: [
        { id: 'shortFloatPct', label: 'Short Float %', type: 'slider', min: 0, max: 50, step: 1, format: (v) => `${v}%` },
        { id: 'daysToCover', label: 'Days to Cover', type: 'number', min: 0, step: 0.1 },
        { id: 'floatTradedPct', label: '% Float Traded Today', type: 'number', min: 0, step: 0.1 },
        { id: 'unusualOptions', label: 'Unusual Options Activity', type: 'toggle' },
      ],
    },
  };

  function buildSchema(sectionIds) {
    const res = { sections: {} };
    sectionIds.forEach((id) => {
      if (sections[id]) res.sections[id] = sections[id];
    });
    return res;
  }

  function defaultValues(sectionIds) {
    const vals = {};
    sectionIds.forEach((id) => {
      const sec = sections[id];
      if (!sec) return;
      (sec.fields || []).forEach((f) => {
        vals[f.id] = f.type === 'multi' ? [] : null;
      });
    });
    return vals;
  }

  global.FilterConfigs = {
    sections,
    buildSchema,
    defaultValues,
  };
})(window);
