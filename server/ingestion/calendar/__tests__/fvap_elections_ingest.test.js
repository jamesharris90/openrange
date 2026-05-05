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
  httpGetText: jest.fn(),
  runCalendarJob: jest.fn(async (_jobName, fn) => fn()),
  upsertEvents: jest.fn(),
}));

const helpers = require('../_helpers');
const { extractElectionEvents, runIngest } = require('../fvap_elections_ingest');

describe('fvap_elections_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 1, updated: 0, dryRun: true });
  });

  test('extractElectionEvents parses dated election headlines', () => {
    const events = extractElectionEvents('<div>Upcoming Elections Presidential Election November 3, 2026</div>');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('ELECTION');
    expect(events[0].importance).toBe(9);
  });

  test('runIngest persists parsed election events', async () => {
    helpers.httpGetText.mockResolvedValue('Upcoming Elections General Election November 3, 2026');

    const result = await runIngest({ dryRun: true });

    expect(result.candidateEvents).toBe(1);
    expect(helpers.upsertEvents).toHaveBeenCalledTimes(1);
  });
});