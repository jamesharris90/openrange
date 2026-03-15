export const unifiedFilterSchema = {
  marketCap: { key: 'marketCap', label: 'Market Cap', type: 'range', min: 0, max: 5000000000000, step: 1000000 },
  relativeVolume: { key: 'relativeVolume', label: 'Relative Volume', type: 'range', min: 0, max: 20, step: 0.1 },
  price: { key: 'price', label: 'Price', type: 'range', min: 0, max: 1000, step: 0.1 },
  sector: { key: 'sector', label: 'Sector', type: 'multi-select', options: [] },
  float: { key: 'float', label: 'Float', type: 'range', min: 0, max: 20000000000, step: 1000000 },
  gapPercent: { key: 'gapPercent', label: 'Gap %', type: 'range', min: -50, max: 200, step: 0.1 },
  shortInterest: { key: 'shortInterest', label: 'Short Interest', type: 'range', min: 0, max: 100, step: 0.1 },
  earningsProximity: { key: 'earningsProximity', label: 'Earnings Proximity (days)', type: 'range', min: 0, max: 90, step: 1 },
  newsCatalysts: { key: 'newsCatalysts', label: 'News Catalysts', type: 'tag' },
  institutionalOwnership: { key: 'institutionalOwnership', label: 'Institutional Ownership', type: 'range', min: 0, max: 100, step: 0.1 },
};

export const unifiedFilterOrder = [
  'marketCap',
  'relativeVolume',
  'price',
  'sector',
  'float',
  'gapPercent',
  'shortInterest',
  'earningsProximity',
  'newsCatalysts',
  'institutionalOwnership',
];

export const filterParamMap = {
  marketCap: ['market_cap', 'market_cap_min', 'market_cap_max'],
  relativeVolume: ['rvol_min', 'rvol_max', 'relative_volume_min', 'relative_volume_max'],
  price: ['price_min', 'price_max'],
  sector: ['sector'],
  float: ['float_min', 'float_max'],
  gapPercent: ['gap_min', 'gap_max'],
  shortInterest: ['short_interest_min', 'short_interest_max'],
  earningsProximity: ['earnings_days_min', 'earnings_days_max'],
  newsCatalysts: ['news_catalysts'],
  institutionalOwnership: ['institutional_ownership_min', 'institutional_ownership_max'],
};
