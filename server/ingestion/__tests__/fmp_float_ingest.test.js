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
const logger = require('../../utils/logger');

const {
  ingestFloat,
  normalizeFloatRecord,
} = require('../fmp_float_ingest');

describe('fmp_float_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('pagination terminates on empty page and summary is accurate', async () => {
    const universeMap = new Map([
      ['AAPL', 'AAPL'],
      ['MSFT', 'MSFT'],
    ]);

    fmpFetch
      .mockResolvedValueOnce([
        { symbol: 'AAPL', floatShares: 10, freeFloat: 20.5, outstandingShares: 30 },
        { symbol: 'MSFT', floatShares: 40, freeFloat: 50.5, outstandingShares: 60 },
      ])
      .mockResolvedValueOnce([]);

    queryWithTimeout.mockResolvedValue({ rowCount: 2 });

    const result = await ingestFloat({ limit: 2, maxPages: 5, batchSize: 100, universeMap });

    expect(result.totalSeen).toBe(2);
    expect(result.totalUpserted).toBe(2);
    expect(result.totalSkipped).toBe(0);
    expect(result.totalErrored).toBe(0);
    expect(result.pagesFetched).toBe(1);
    expect(fmpFetch).toHaveBeenCalledTimes(2);
  });

  test('normalize skips foreign symbols not present in ticker_universe', () => {
    const universeMap = new Map([['AAPL', 'AAPL']]);

    expect(normalizeFloatRecord({ symbol: 'VOD.L' }, universeMap)).toEqual({
      status: 'skipped',
      symbol: 'VOD.L',
    });

    expect(normalizeFloatRecord({ symbol: 'SHOP.TO' }, universeMap)).toEqual({
      status: 'skipped',
      symbol: 'SHOP.TO',
    });
  });

  test('normalize handles null and missing fields gracefully', () => {
    const universeMap = new Map([['AAPL', 'AAPL']]);
    const result = normalizeFloatRecord({ symbol: 'AAPL', floatShares: null }, universeMap, '2026-05-04T00:00:00.000Z');

    expect(result).toEqual({
      status: 'upsert',
      row: {
        symbol: 'AAPL',
        float_shares: null,
        free_float_pct: null,
        shares_outstanding: null,
        float_updated_at: '2026-05-04T00:00:00.000Z',
      },
    });
  });

  test('error in one record does not fail whole batch', async () => {
    const universeMap = new Map([
      ['AAPL', 'AAPL'],
      ['MSFT', 'MSFT'],
    ]);

    fmpFetch
      .mockResolvedValueOnce([
        { symbol: 'AAPL', floatShares: 10, freeFloat: 20, outstandingShares: 30 },
        { get symbol() { throw new Error('broken record'); } },
        { symbol: 'MSFT', floatShares: 11, freeFloat: 21, outstandingShares: 31 },
      ])
      .mockResolvedValueOnce([]);

    queryWithTimeout.mockResolvedValue({ rowCount: 2 });

    const result = await ingestFloat({ limit: 3, maxPages: 2, batchSize: 100, universeMap });

    expect(result.totalSeen).toBe(3);
    expect(result.totalUpserted).toBe(2);
    expect(result.totalErrored).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test('falls back to row-by-row upsert when a batch fails and keeps summary accurate', async () => {
    const universeMap = new Map([
      ['AAPL', 'AAPL'],
      ['MSFT', 'MSFT'],
    ]);

    fmpFetch
      .mockResolvedValueOnce([
        { symbol: 'AAPL', floatShares: 10, freeFloat: 20, outstandingShares: 30 },
        { symbol: 'MSFT', floatShares: 40, freeFloat: 50, outstandingShares: 60 },
      ])
      .mockResolvedValueOnce([]);

    queryWithTimeout
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await ingestFloat({ limit: 2, maxPages: 2, batchSize: 2, universeMap });

    expect(result.totalUpserted).toBe(2);
    expect(result.totalErrored).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});