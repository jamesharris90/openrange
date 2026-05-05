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

jest.mock('../../services/smartMoneyWorkingSet', () => ({
  resolveSmartMoneyWorkingSet: jest.fn(),
}));

const { fmpFetch } = require('../../services/fmpClient');
const { queryWithTimeout } = require('../../db/pg');
const { resolveSmartMoneyWorkingSet } = require('../../services/smartMoneyWorkingSet');
const {
  fetchLatestRows,
  normalizeCongressionalRow,
  parseAmountRange,
  runIngest,
  upsertCongressionalTrades,
} = require('../fmp_senate_house_ingest');

describe('fmp_senate_house_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveSmartMoneyWorkingSet.mockResolvedValue(['AAPL', 'MSFT']);
  });

  test.each([
    ['$1,001 - $15,000', { min: 1001, max: 15000 }],
    ['$15,001 - $50,000', { min: 15001, max: 50000 }],
    ['$50,001 - $100,000', { min: 50001, max: 100000 }],
    ['$100,001 - $250,000', { min: 100001, max: 250000 }],
    ['$250,001 - $500,000', { min: 250001, max: 500000 }],
    ['$500,001 - $1,000,000', { min: 500001, max: 1000000 }],
    ['$1,000,001 - $5,000,000', { min: 1000001, max: 5000000 }],
    ['$5,000,001 - $25,000,000', { min: 5000001, max: 25000000 }],
    ['$25,000,001 - $50,000,000', { min: 25000001, max: 50000000 }],
  ])('parseAmountRange parses %s', (input, expected) => {
    expect(parseAmountRange(input)).toEqual(expected);
  });

  test('parseAmountRange handles over, blank, and malformed values', () => {
    expect(parseAmountRange('Over $50,000,000')).toEqual({ min: 50000000, max: null });
    expect(parseAmountRange('Spouse/DC')).toEqual({ min: null, max: null });
    expect(parseAmountRange('')).toEqual({ min: null, max: null });
    expect(parseAmountRange('not a range')).toEqual({ min: null, max: null });
  });

  test('normalize defaults owner_type to Self and maps derived fields', () => {
    const result = normalizeCongressionalRow({
      symbol: 'aapl',
      disclosureDate: '2026-05-01',
      transactionDate: '2026-04-29',
      firstName: 'Nancy',
      lastName: 'Pelosi',
      office: 'CA',
      district: '11',
      assetDescription: 'Apple Inc',
      assetType: 'Stock',
      type: 'Purchase',
      amount: '$15,001 - $50,000',
      capitalGainsOver200USD: 'True',
      comment: 'Test',
      link: 'https://example.test',
    }, 'House');

    expect(result.status).toBe('upsert');
    expect(result.row.owner_type).toBe('Self');
    expect(result.row.owner).toBe('Self');
    expect(result.row.chamber).toBe('House');
    expect(result.row.amount_min_usd).toBe(15001);
    expect(result.row.amount_max_usd).toBe(50000);
    expect(result.row.full_member_name).toBe('Nancy Pelosi');
    expect(result.row.has_capital_gains_over_200_usd).toBe(true);
  });

  test('fetchLatestRows paginates until empty page', async () => {
    fmpFetch
      .mockResolvedValueOnce([{ symbol: 'AAPL', disclosureDate: '2026-05-01', transactionDate: '2026-04-29', firstName: 'Nancy', lastName: 'Pelosi', type: 'Purchase', amount: '$1,001 - $15,000' }])
      .mockResolvedValueOnce([]);

    const result = await fetchLatestRows('Senate', { limit: 1, maxPages: 5 });
    expect(result.rows).toHaveLength(1);
    expect(result.fetched).toBe(1);
    expect(fmpFetch).toHaveBeenCalledTimes(2);
  });

  test('upsert dedupes identical congressional rows before persistence', async () => {
    queryWithTimeout.mockResolvedValue({ rowCount: 1, rows: [] });

    const row = {
      chamber: 'Senate', symbol: 'AAPL', disclosure_date: '2026-05-01', transaction_date: '2026-04-29',
      first_name: 'Nancy', last_name: 'Pelosi', office: 'CA', district: '11', owner: 'Self', asset_description: 'Apple',
      asset_type: 'Stock', transaction_type: 'Purchase', amount_range: '$1,001 - $15,000', amount_min: 1001, amount_max: 15000,
      capital_gains_over_200: false, comment: null, source_link: 'https://x', member_first_name: 'Nancy', member_last_name: 'Pelosi',
      member_office: 'CA', member_district: '11', owner_type: 'Self', has_capital_gains_over_200_usd: false, notes: null,
      filing_url: 'https://x', amount_min_usd: 1001, amount_max_usd: 15000, full_member_name: 'Nancy Pelosi', raw_payload: {},
    };

    const result = await upsertCongressionalTrades([row, row]);
    expect(result.deduped).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(queryWithTimeout).toHaveBeenCalledTimes(1);
  });

  test('runIngest dry run avoids DB writes and includes backfill path', async () => {
    fmpFetch
      .mockResolvedValueOnce([{ symbol: 'AAPL', disclosureDate: '2026-05-01', transactionDate: '2026-04-29', firstName: 'Nancy', lastName: 'Pelosi', type: 'Purchase', amount: '$1,001 - $15,000' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ symbol: 'MSFT', disclosureDate: '2026-05-01', transactionDate: '2026-04-29', firstName: 'Dan', lastName: 'Crenshaw', type: 'Purchase', amount: '$15,001 - $50,000', owner: '' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ symbol: 'AAPL', disclosureDate: '2026-04-01', transactionDate: '2026-03-25', firstName: 'Nancy', lastName: 'Pelosi', type: 'Purchase', amount: '$50,001 - $100,000' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    queryWithTimeout.mockResolvedValueOnce({ rows: [] });

    const result = await runIngest({ DRY_RUN: true, includeBackfill: true, maxSymbols: 1, maxPages: 2 });
    expect(result.dryRun).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.deduped).toBeGreaterThan(0);
    expect(result.backfill.symbolsProcessed).toBe(2);
    expect(queryWithTimeout).toHaveBeenCalledTimes(1);
  });
});