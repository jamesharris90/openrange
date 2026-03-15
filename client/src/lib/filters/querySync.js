export function parseUnifiedFiltersFromSearch(searchParams) {
  const params = searchParams instanceof URLSearchParams ? searchParams : new URLSearchParams(searchParams || '');
  const readRange = (prefix, fallbackMin = '', fallbackMax = '') => ({
    min: params.get(`${prefix}_min`) ?? fallbackMin,
    max: params.get(`${prefix}_max`) ?? fallbackMax,
  });

  return {
    marketCap: readRange('market_cap'),
    relativeVolume: readRange('rvol'),
    price: readRange('price'),
    sector: params.getAll('sector'),
    float: readRange('float'),
    gapPercent: readRange('gap'),
    shortInterest: readRange('short_interest'),
    earningsProximity: readRange('earnings_days'),
    newsCatalysts: params.getAll('news_catalyst'),
    institutionalOwnership: readRange('institutional_ownership'),
  };
}

export function writeUnifiedFiltersToSearch(filters) {
  const params = new URLSearchParams();
  const writeRange = (prefix, range) => {
    if (!range || typeof range !== 'object') return;
    if (range.min !== '' && range.min != null) params.set(`${prefix}_min`, String(range.min));
    if (range.max !== '' && range.max != null) params.set(`${prefix}_max`, String(range.max));
  };

  writeRange('market_cap', filters.marketCap);
  writeRange('rvol', filters.relativeVolume);
  writeRange('price', filters.price);
  (filters.sector || []).forEach((value) => params.append('sector', value));
  writeRange('float', filters.float);
  writeRange('gap', filters.gapPercent);
  writeRange('short_interest', filters.shortInterest);
  writeRange('earnings_days', filters.earningsProximity);
  (filters.newsCatalysts || []).forEach((value) => params.append('news_catalyst', value));
  writeRange('institutional_ownership', filters.institutionalOwnership);

  return params;
}

export function toLegacyQueryParams(filters) {
  const params = writeUnifiedFiltersToSearch(filters);
  const remap = [
    ['market_cap_min', 'market_cap_min'],
    ['market_cap_max', 'market_cap_max'],
    ['rvol_min', 'rvol_min'],
    ['rvol_max', 'rvol_max'],
    ['price_min', 'price_min'],
    ['price_max', 'price_max'],
    ['float_min', 'float_min'],
    ['float_max', 'float_max'],
    ['gap_min', 'gap_min'],
    ['gap_max', 'gap_max'],
  ];

  remap.forEach(([source, target]) => {
    const value = params.get(source);
    if (value != null) params.set(target, value);
  });

  const sector = params.getAll('sector');
  if (sector.length === 1) params.set('sector', sector[0]);

  return params;
}
