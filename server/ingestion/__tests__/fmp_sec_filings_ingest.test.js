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
  ingestFilings,
  classifyFormType,
  validateRequestWindow,
  normalizeFilingRecord,
} = require('../fmp_sec_filings_ingest');

describe('fmp_sec_filings_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('classifyFormType maps supported and unknown forms correctly', () => {
    expect(classifyFormType('8-K')).toEqual({ catalyst_category: 'material_event', is_offering: false });
    expect(classifyFormType('10-K')).toEqual({ catalyst_category: 'earnings', is_offering: false });
    expect(classifyFormType('10-Q')).toEqual({ catalyst_category: 'earnings', is_offering: false });
    expect(classifyFormType('S-1')).toEqual({ catalyst_category: 'offering', is_offering: true });
    expect(classifyFormType('S-1/A')).toEqual({ catalyst_category: 'offering', is_offering: true });
    expect(classifyFormType('424B5')).toEqual({ catalyst_category: 'offering', is_offering: true });
    expect(classifyFormType('13D')).toEqual({ catalyst_category: 'ownership', is_offering: false });
    expect(classifyFormType('13G/A')).toEqual({ catalyst_category: 'ownership', is_offering: false });
    expect(classifyFormType('Form 4')).toEqual({ catalyst_category: 'ownership', is_offering: false });
    expect(classifyFormType('DEF 14A')).toEqual({ catalyst_category: 'governance', is_offering: false });
    expect(classifyFormType('SC 13E3')).toEqual({ catalyst_category: 'other', is_offering: false });
  });

  test('pagination terminates on empty page', async () => {
    const universeMap = new Map([['AAPL', 'AAPL']]);

    fmpFetch
      .mockResolvedValueOnce([
        {
          symbol: 'AAPL',
          cik: '1',
          filingDate: '2026-04-30 00:00:00',
          acceptedDate: '2026-04-30 18:00:00',
          formType: '8-K',
          hasFinancials: false,
          link: 'a',
          finalLink: 'b',
        },
      ])
      .mockResolvedValueOnce([]);

    queryWithTimeout.mockResolvedValue({ rowCount: 1, rows: [] });

    const result = await ingestFilings({ fromDate: '2026-04-25', toDate: '2026-04-30', maxPages: 5, limit: 10, universeMap });

    expect(result.totalSeen).toBe(1);
    expect(result.totalUpserted).toBe(1);
    expect(result.pagesFetched).toBe(1);
    expect(fmpFetch).toHaveBeenCalledTimes(2);
  });

  test('pagination terminates at page 100', async () => {
    const universeMap = new Map([['AAPL', 'AAPL']]);

    fmpFetch.mockImplementation(async () => ([{
      symbol: 'AAPL',
      cik: '1',
      filingDate: '2026-04-30 00:00:00',
      acceptedDate: '2026-04-30 18:00:00',
      formType: '8-K',
      hasFinancials: false,
      link: 'a',
      finalLink: 'b',
    }]));
    queryWithTimeout.mockResolvedValue({ rowCount: 1, rows: [] });

    const result = await ingestFilings({ fromDate: '2026-04-25', toDate: '2026-04-30', maxPages: 150, limit: 10, universeMap });

    expect(result.pagesFetched).toBe(100);
    expect(fmpFetch).toHaveBeenCalledTimes(100);
  });

  test('normalize skips records where symbol is null or empty', () => {
    const universeMap = new Map([['AAPL', 'AAPL']]);

    expect(normalizeFilingRecord({ symbol: null }, universeMap)).toEqual({ status: 'skipped', reason: 'missing_symbol' });
    expect(normalizeFilingRecord({ symbol: '' }, universeMap)).toEqual({ status: 'skipped', reason: 'missing_symbol' });
  });

  test('normalize filters to ticker_universe matches only', () => {
    const universeMap = new Map([['AAPL', 'AAPL']]);
    const result = normalizeFilingRecord({
      symbol: 'VOD.L',
      cik: '2',
      filingDate: '2026-04-30 00:00:00',
      acceptedDate: '2026-04-30 18:00:00',
      formType: '8-K',
    }, universeMap);

    expect(result).toEqual({ status: 'skipped', reason: 'symbol_not_tracked', symbol: 'VOD.L' });
  });

  test('90-day range validation rejects requests outside the window', () => {
    expect(() => validateRequestWindow('2026-01-01', '2026-04-15')).toThrow('Date range exceeds 90 days');
  });
});
