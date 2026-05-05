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
const {
  buildLockupEvent,
  normalizeIpoRow,
  runIngest,
} = require('../fmp_ipo_ingest');

describe('fmp_ipo_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 4, updated: 0, dryRun: true });
  });

  test('normalizeIpoRow derives symbol, date, and importance', () => {
    const event = normalizeIpoRow({
      date: '2026-06-01',
      symbol: 'orng',
      company: 'Open Range',
      exchange: 'NASDAQ',
      marketCap: 1500000000,
      shares: 1000000,
    });

    expect(event.symbol).toBe('ORNG');
    expect(event.importance).toBe(9);
    expect(event.metadata.marketCap).toBe(1500000000);
  });

  test('buildLockupEvent derives estimated expiry date from ipo date', () => {
    const lockup = buildLockupEvent({
      event_date: '2026-06-01',
      symbol: 'ORNG',
      source_url: '/stable/ipos-calendar',
      metadata: { marketCap: 1500000000 },
      raw_payload: { symbol: 'ORNG' },
    });

    expect(lockup.event_type).toBe('LOCKUP_EXPIRY');
    expect(lockup.event_date).toBe('2026-11-28');
    expect(lockup.confidence).toBe('estimated');
  });

  test('runIngest aggregates IPO, disclosure, prospectus, and lockup events', async () => {
    fmpFetch
      .mockResolvedValueOnce([{ date: '2026-06-01', symbol: 'ORNG', company: 'Open Range', marketCap: 500000000 }])
      .mockResolvedValueOnce([{ date: '2026-05-20', symbol: 'ORNG', company: 'Open Range', form: 'S-1' }])
      .mockResolvedValueOnce([{ date: '2026-05-25', symbol: 'ORNG', company: 'Open Range', form: '424B4' }]);

    const result = await runIngest({ dryRun: true, today: '2026-06-01' });

    expect(result.ipoCount).toBe(1);
    expect(result.lockupCount).toBe(1);
    expect(result.disclosureCount).toBe(1);
    expect(result.prospectusCount).toBe(1);
    expect(helpers.upsertEvents).toHaveBeenCalledTimes(1);
  });
});