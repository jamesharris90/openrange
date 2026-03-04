import type { FilterSchema } from './filterTypes';

const exchangeOptions = [
  { label: 'Any', value: '' },
  { label: 'NYSE', value: 'exch_nyse' },
  { label: 'NASDAQ', value: 'exch_nasd' },
  { label: 'AMEX', value: 'exch_amex' },
];

const sectorOptions = [
  { label: 'Any', value: '' },
  { label: 'Technology', value: 'sec_technology' },
  { label: 'Healthcare', value: 'sec_healthcare' },
  { label: 'Financial', value: 'sec_financials' },
  { label: 'Energy', value: 'sec_energy' },
  { label: 'Industrials', value: 'sec_industrials' },
];

const countryOptions = [
  { label: 'Any', value: '' },
  { label: 'USA', value: 'geo_usa' },
  { label: 'Canada', value: 'geo_canada' },
  { label: 'UK', value: 'geo_uk' },
  { label: 'China', value: 'geo_china' },
];

const rsiOptions = [
  { label: 'Any', value: '' },
  { label: 'Oversold (<30)', value: 'ta_rsi_os30' },
  { label: 'Overbought (>70)', value: 'ta_rsi_ob70' },
  { label: 'Bullish (50-70)', value: 'ta_rsi_nob50' },
];

const perfWeekOptions = [
  { label: 'Any', value: '' },
  { label: 'Up 5%+', value: 'ta_perf_1wup' },
  { label: 'Down 5%+', value: 'ta_perf_1wdown' },
];

const etfOptions = [
  { label: 'Any', value: '' },
  { label: 'S&P 500', value: 'idx_sp500' },
  { label: 'DJIA', value: 'idx_dji' },
];

export const filterSchema: FilterSchema = {
  overview: [
    { key: 'exchange', label: 'Exchange', type: 'select', tab: 'overview', options: exchangeOptions, finvizCode: 'exchange' },
    { key: 'sector', label: 'Sector', type: 'select', tab: 'overview', options: sectorOptions, finvizCode: 'sector' },
    { key: 'country', label: 'Country', type: 'select', tab: 'overview', options: countryOptions, finvizCode: 'country' },
    { key: 'marketCap', label: 'Market Cap', type: 'range', tab: 'overview', dataKey: 'Market Cap', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'price', label: 'Price', type: 'range', tab: 'overview', dataKey: 'Price', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'volume', label: 'Volume', type: 'range', tab: 'overview', dataKey: 'Volume', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  valuation: [
    { key: 'pe', label: 'P/E', type: 'range', tab: 'valuation', dataKey: 'P/E', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'forwardPe', label: 'Forward P/E', type: 'range', tab: 'valuation', dataKey: 'Forward P/E', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'peg', label: 'PEG', type: 'range', tab: 'valuation', dataKey: 'PEG', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'ps', label: 'P/S', type: 'range', tab: 'valuation', dataKey: 'P/S', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'pb', label: 'P/B', type: 'range', tab: 'valuation', dataKey: 'P/B', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  financial: [
    { key: 'dividendYield', label: 'Dividend Yield', type: 'range', tab: 'financial', dataKey: 'Dividend Yield', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'roe', label: 'ROE', type: 'range', tab: 'financial', dataKey: 'Return on Equity', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'roa', label: 'ROA', type: 'range', tab: 'financial', dataKey: 'Return on Assets', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'debtToEquity', label: 'Debt/Equity', type: 'range', tab: 'financial', dataKey: 'Total Debt/Equity', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  ownership: [
    { key: 'insiderOwnership', label: 'Insider Ownership', type: 'range', tab: 'ownership', dataKey: 'Insider Ownership', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'institutionalOwnership', label: 'Institutional Ownership', type: 'range', tab: 'ownership', dataKey: 'Institutional Ownership', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'shortFloat', label: 'Short Float', type: 'range', tab: 'ownership', dataKey: 'Short Float', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'sharesFloat', label: 'Shares Float', type: 'range', tab: 'ownership', dataKey: 'Shares Float', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  performance: [
    { key: 'perfWeek', label: '1W Performance', type: 'select', tab: 'performance', options: perfWeekOptions, finvizCode: 'perfWeek' },
    { key: 'perfMonth', label: '1M Performance', type: 'range', tab: 'performance', dataKey: 'Performance (Month)', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'perfQuarter', label: '3M Performance', type: 'range', tab: 'performance', dataKey: 'Performance (Quarter)', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'relativeVolume', label: 'Relative Volume', type: 'range', tab: 'performance', dataKey: 'Relative Volume', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  technical: [
    { key: 'rsiMode', label: 'RSI Mode', type: 'select', tab: 'technical', options: rsiOptions, finvizCode: 'rsiMode' },
    { key: 'rsi14', label: 'RSI (14)', type: 'range', tab: 'technical', dataKey: 'Relative Strength Index (14)', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'sma20', label: '20 SMA %', type: 'range', tab: 'technical', dataKey: '20-Day Simple Moving Average', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'sma50', label: '50 SMA %', type: 'range', tab: 'technical', dataKey: '50-Day Simple Moving Average', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'atr', label: 'ATR', type: 'range', tab: 'technical', dataKey: 'Average True Range', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  news: [
    { key: 'newsScore', label: 'News Score', type: 'range', tab: 'news', dataKey: '_newsAge', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'change', label: 'Change %', type: 'range', tab: 'news', dataKey: 'Change', placeholderMin: 'Min %', placeholderMax: 'Max %' },
    { key: 'avgVolume', label: 'Average Volume', type: 'range', tab: 'news', dataKey: 'Average Volume', placeholderMin: 'Min', placeholderMax: 'Max' },
  ],
  etf: [
    { key: 'index', label: 'Index', type: 'select', tab: 'etf', options: etfOptions, finvizCode: 'index' },
    { key: 'beta', label: 'Beta', type: 'range', tab: 'etf', dataKey: 'Beta', placeholderMin: 'Min', placeholderMax: 'Max' },
    { key: 'volWeek', label: 'Volatility Week', type: 'range', tab: 'etf', dataKey: 'Volatility (Week)', placeholderMin: 'Min %', placeholderMax: 'Max %' },
  ],
};

export const filterTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'financial', label: 'Financial' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'performance', label: 'Performance' },
  { id: 'technical', label: 'Technical' },
  { id: 'news', label: 'News' },
  { id: 'etf', label: 'ETF' },
] as const;

export const adaptiveFilterSchema = [
  { key: 'gapPercent', label: 'Gap %', type: 'range', tab: 'technical', dataKey: 'Gap %', placeholderMin: 'Min %', placeholderMax: 'Max %' },
  { key: 'relativeVolume', label: 'Relative Volume', type: 'range', tab: 'technical', dataKey: 'Relative Volume', placeholderMin: 'Min', placeholderMax: 'Max' },
  { key: 'atrPercent', label: 'ATR %', type: 'range', tab: 'technical', dataKey: 'ATR %', placeholderMin: 'Min %', placeholderMax: 'Max %' },
  { key: 'rsi14', label: 'RSI 14', type: 'range', tab: 'technical', dataKey: 'RSI 14', placeholderMin: 'Min', placeholderMax: 'Max' },
  { key: 'vwapDistance', label: 'VWAP Distance %', type: 'range', tab: 'technical', dataKey: 'VWAP Distance %', placeholderMin: 'Min %', placeholderMax: 'Max %' },
  { key: 'floatShares', label: 'Float Shares (M)', type: 'range', tab: 'technical', dataKey: 'Float Shares', placeholderMin: 'Min', placeholderMax: 'Max' },
  {
    key: 'structureType',
    label: 'Structure Type',
    type: 'select',
    tab: 'technical',
    options: [
      { label: 'Any', value: '' },
      { label: 'ORB', value: 'ORB' },
      { label: 'Gap & Go', value: 'GapAndGo' },
      { label: 'Trend Day', value: 'TrendDay' },
      { label: 'VWAP Reclaim', value: 'VWAPReclaim' },
      { label: 'Micro Pullback', value: 'MicroPullback' },
      { label: 'Liquidity Sweep', value: 'LiquiditySweep' },
      { label: 'Compression Breakout', value: 'CompressionBreakout' },
      { label: 'Breakdown', value: 'Breakdown' },
      { label: 'Mean Reversion', value: 'MeanReversion' },
      { label: 'Squeeze', value: 'Squeeze' },
      { label: 'Drift', value: 'Drift' },
      { label: 'Reversal Base', value: 'ReversalBase' },
    ],
  },
  {
    key: 'minGrade',
    label: 'Min Grade',
    type: 'select',
    tab: 'technical',
    options: [
      { label: 'Any', value: '' },
      { label: 'A+', value: 'A+' },
      { label: 'A', value: 'A' },
      { label: 'B', value: 'B' },
      { label: 'C', value: 'C' },
    ],
  },
  {
    key: 'adaptToSpy',
    label: 'Adapt to SPY',
    type: 'select',
    tab: 'technical',
    options: [
      { label: 'Off', value: '' },
      { label: 'On', value: 'true' },
    ],
  },
] as const;
