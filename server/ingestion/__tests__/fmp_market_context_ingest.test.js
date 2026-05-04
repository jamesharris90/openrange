jest.mock('../../services/fmpClient', () => ({
  fmpFetch: jest.fn(),
}));

jest.mock('../../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { fmpFetch } = require('../../services/fmpClient');
const { queryWithTimeout } = require('../../db/pg');

const {
  CONTEXT_SYMBOLS,
  REQUEST_SYMBOLS,
  ingestMarketContext,
  getMarketContext,
  classifyVixLevel,
  classifyMarketRegime,
  buildMarketContext,
} = require('../fmp_market_context_ingest');

describe('fmp_market_context_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ingestMarketContext fetches batch quotes for all configured symbols and upserts them', async () => {
    fmpFetch.mockResolvedValue([
      { symbol: 'SPY', price: 700, changePercentage: 0.6, volume: 100, marketCap: 1, previousClose: 695, timestamp: 1777665600 },
      { symbol: 'QQQ', price: 600, changePercentage: 0.8, volume: 200, marketCap: 2, previousClose: 595, timestamp: 1777665600 },
      { symbol: '^VIX', price: 17, changePercentage: -1.2, volume: 300, marketCap: 3, previousClose: 18, timestamp: 1777665600 },
      { symbol: 'XLF', price: 50, changePercentage: 1.1, volume: 400, marketCap: 4, previousClose: 49, timestamp: 1777665600 },
    ]);
    queryWithTimeout.mockResolvedValue({ rowCount: 4, rows: [] });

    const result = await ingestMarketContext();

    expect(fmpFetch).toHaveBeenCalledWith('/batch-quote', { symbols: REQUEST_SYMBOLS });
    expect(result.requestedSymbols).toBe(CONTEXT_SYMBOLS.length);
    expect(result.totalUpserted).toBe(4);
    expect(result.totalErrored).toBe(0);
    expect(result.missingSymbols).toContain('IWM');
    expect(queryWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('vix level classification covers boundary values', () => {
    expect(classifyVixLevel(14.99)).toBe('low');
    expect(classifyVixLevel(15)).toBe('normal');
    expect(classifyVixLevel(20)).toBe('normal');
    expect(classifyVixLevel(20.01)).toBe('elevated');
    expect(classifyVixLevel(30)).toBe('elevated');
    expect(classifyVixLevel(30.01)).toBe('high');
  });

  test('market regime heuristic covers risk_on risk_off and neutral', () => {
    expect(classifyMarketRegime(0.8, 17, -1)).toBe('risk_on');
    expect(classifyMarketRegime(-0.9, 27, 2)).toBe('risk_off');
    expect(classifyMarketRegime(0.1, 19, 0.5)).toBe('neutral');
  });

  test('getMarketContext returns the expected structure', async () => {
    queryWithTimeout
      .mockResolvedValueOnce({
        rows: [
          { symbol: 'SPY', price: '700', change_percent: '0.8', previous_close: '695', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
          { symbol: 'QQQ', price: '600', change_percent: '0.7', previous_close: '596', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
          { symbol: 'IWM', price: '250', change_percent: '0.2', previous_close: '249', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
          { symbol: 'VIX', price: '17', change_percent: '-1.1', previous_close: '18', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
          { symbol: 'XLF', price: '50', change_percent: '1.4', previous_close: '49', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
          { symbol: 'XLK', price: '80', change_percent: '0.4', previous_close: '79', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { symbol: 'SPY', close: '690' },
          { symbol: 'QQQ', close: '590' },
          { symbol: 'IWM', close: '255' },
          { symbol: 'VIX', close: '20' },
          { symbol: 'XLF', close: '48' },
          { symbol: 'XLK', close: '82' },
        ],
      });

    const result = await getMarketContext();

    expect(result.spy).toEqual({
      price: 700,
      changePercent: 0.8,
      isAbove200d: true,
      premarketChangePercent: expect.any(Number),
    });
    expect(result.vix).toEqual({
      price: 17,
      changePercent: -1.1,
      premarketChangePercent: expect.any(Number),
      level: 'normal',
    });
    expect(result.marketRegime).toBe('risk_on');
    expect(result.sectors.XLF.rank).toBe(1);
    expect(result.sectors.XLK.rank).toBeGreaterThan(1);
    expect(result.timestamp).toBe('2026-05-04T12:00:00.000Z');
  });

  test('missing symbols do not crash buildMarketContext', () => {
    const result = buildMarketContext(
      [
        { symbol: 'SPY', price: '700', change_percent: '0.1', previous_close: '699', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
        { symbol: 'VIX', price: '24', change_percent: '2.5', previous_close: '23', updated_at: '2026-05-04T12:00:00.000Z', last_updated: '2026-05-04T12:00:00.000Z' },
      ],
      [
        { symbol: 'SPY', close: '695' },
        { symbol: 'VIX', close: '21' },
      ]
    );

    expect(result.qqq).toBeNull();
    expect(result.iwm).toBeNull();
    expect(result.vix.level).toBe('elevated');
    expect(result.marketRegime).toBe('neutral');
    expect(result.sectors.XLF).toEqual({
      price: null,
      changePercent: null,
      isAbove200d: null,
      premarketChangePercent: null,
      rank: expect.any(Number),
      sectorName: 'Financials',
    });
  });
});