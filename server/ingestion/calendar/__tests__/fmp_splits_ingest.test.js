jest.mock('../../../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../services/fmpClient', () => ({
  fmpFetch: jest.fn(),
}));

jest.mock('../_helpers', () => ({
  ...jest.requireActual('../_helpers'),
  flagSystemHealth: jest.fn(),
  resolveSystemFlag: jest.fn(),
  runCalendarJob: jest.fn(async (_jobName, fn) => fn()),
  upsertEvents: jest.fn(),
}));

const { fmpFetch } = require('../../../services/fmpClient');
const helpers = require('../_helpers');
const { normalizeSplitRow, runIngest } = require('../fmp_splits_ingest');

describe('fmp_splits_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 1, updated: 0, dryRun: true });
  });

  test('normalizeSplitRow maps split ratio and importance', () => {
    const event = normalizeSplitRow({
      date: '2026-06-01',
      symbol: 'aapl',
      numerator: 1,
      denominator: 10,
      ratio: '1:10',
    });

    expect(event.symbol).toBe('AAPL');
    expect(event.importance).toBe(8);
    expect(event.metadata.ratio).toBe('1:10');
  });

  test('runIngest persists normalized split events', async () => {
    fmpFetch.mockResolvedValue([{ date: '2026-06-01', symbol: 'AAPL', numerator: 1, denominator: 10, ratio: '1:10' }]);

    const result = await runIngest({ dryRun: true, today: '2026-06-01' });

    expect(result.fetched).toBe(1);
    expect(result.candidateEvents).toBe(1);
    expect(helpers.upsertEvents).toHaveBeenCalledTimes(1);
  });
});