jest.mock('../../../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../_helpers', () => ({
  ...jest.requireActual('../_helpers'),
  httpGetJson: jest.fn(),
  runCalendarJob: jest.fn(async (_jobName, fn) => fn()),
  upsertEvents: jest.fn(),
}));

const helpers = require('../_helpers');
const {
  RELEASES,
  normalizeReleaseEvent,
  runIngest,
} = require('../fred_economic_ingest');

describe('fred_economic_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.httpGetJson.mockResolvedValue({ release_dates: [{ date: '2026-06-12' }] });
    helpers.upsertEvents.mockResolvedValue({ inserted: 10, updated: 0, dryRun: true });
  });

  test('normalizeReleaseEvent assigns release metadata and time', () => {
    const event = normalizeReleaseEvent('46', RELEASES[46], '2026-06-05');
    expect(event.event_type).toBe('ECONOMIC_RELEASE');
    expect(event.event_time).toBe('08:30 ET');
    expect(event.metadata.release_type).toBe('NFP');
  });

  test('runIngest fetches each configured release and persists normalized events', async () => {
    const result = await runIngest({ dryRun: true, fromDate: '2026-06-01', toDate: '2026-06-30' });

    expect(helpers.httpGetJson).toHaveBeenCalledTimes(Object.keys(RELEASES).length);
    expect(helpers.upsertEvents).toHaveBeenCalledTimes(1);
    expect(result.candidateEvents).toBe(Object.keys(RELEASES).length);
  });
});