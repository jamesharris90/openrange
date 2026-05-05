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
  fetchSymbolRows,
  normalizeInsiderTradeRow,
  upsertInsiderTrades,
} = require('../fmp_insider_trades_ingest');

describe('fmp_insider_trades_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalize maps expected fields and computes total value', () => {
    const result = normalizeInsiderTradeRow({
      filingDate: '2026-05-01',
      transactionDate: '2026-04-29',
      reportingCik: '123',
      reportingName: 'Jane Doe',
      typeOfOwner: 'CEO',
      transactionType: 'P-Purchase',
      acquisitionOrDisposition: 'A',
      formType: '4',
      securitiesTransacted: 100,
      securitiesOwned: 500,
      price: 12.5,
      securityName: 'Common Stock',
      url: 'https://sec.example',
    }, 'AAPL');

    expect(result.status).toBe('upsert');
    expect(result.row.total_value).toBe(1250);
    expect(result.row.reporting_cik).toBe('123');
  });

  test('normalize skips malformed rows missing transaction type', () => {
    expect(normalizeInsiderTradeRow({
      filingDate: '2026-05-01',
      transactionDate: '2026-04-29',
      reportingName: 'Jane Doe',
    }, 'AAPL')).toEqual({ status: 'skipped', reason: 'missing_required_fields' });
  });

  test('fetchSymbolRows paginates until empty page', async () => {
    fmpFetch
      .mockResolvedValueOnce([{ filingDate: '2026-05-01', transactionDate: '2026-04-29', reportingCik: '1', reportingName: 'Jane', transactionType: 'P-Purchase', securitiesTransacted: 10, price: 2 }])
      .mockResolvedValueOnce([]);

    const result = await fetchSymbolRows('AAPL', { limit: 1, maxPages: 5 });
    expect(result.rows).toHaveLength(1);
    expect(result.pagesFetched).toBe(1);
    expect(fmpFetch).toHaveBeenCalledTimes(2);
  });

  test('upsert dedupes conflicting insider rows before persistence', async () => {
    queryWithTimeout.mockResolvedValue({ rowCount: 1, rows: [] });

    const result = await upsertInsiderTrades([
      {
        symbol: 'AAPL', reporting_cik: '1', transaction_date: '2026-04-29', transaction_type: 'P-Purchase', securities_transacted: 10,
        filing_date: '2026-05-01', reporting_name: 'Jane', type_of_owner: 'CEO', acquisition_or_disposition: 'A', form_type: '4', securities_owned: 100, price: 2, total_value: 20, security_name: 'Common', sec_filing_url: 'u', raw_payload: {},
      },
      {
        symbol: 'AAPL', reporting_cik: '1', transaction_date: '2026-04-29', transaction_type: 'P-Purchase', securities_transacted: 10,
        filing_date: '2026-05-01', reporting_name: 'Jane', type_of_owner: 'CEO', acquisition_or_disposition: 'A', form_type: '4', securities_owned: 100, price: 2, total_value: 20, security_name: 'Common', sec_filing_url: 'u', raw_payload: {},
      },
    ]);

    expect(result.deduped).toBe(1);
    expect(queryWithTimeout).toHaveBeenCalledTimes(1);
  });
});