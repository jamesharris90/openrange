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
  httpGetText: jest.fn(),
  runCalendarJob: jest.fn(async (_jobName, fn) => fn()),
  upsertEvents: jest.fn(),
}));

const helpers = require('../_helpers');
const { normalizeFedEvent, parseFallbackHtml, runIngest } = require('../fomc_ingest');

describe('fomc_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 1, updated: 0, dryRun: true });
  });

  test('normalizeFedEvent keeps FOMC rows and normalizes fields', () => {
    const event = normalizeFedEvent({
      type: 'FOMC',
      title: 'FOMC Meeting',
      month: '2026-06',
      days: '17-18',
      description: '<p>Policy statement</p>',
      time: '14:00 ET',
    });

    expect(event.event_type).toBe('FOMC');
    expect(event.event_date).toBe('2026-06-17');
    expect(event.description).toBe('Policy statement');
  });

  test('parseFallbackHtml extracts meeting references from html', () => {
    const events = parseFallbackHtml('<html>Meeting calendars and information January 28-29, 2026</html>');
    expect(events).toHaveLength(1);
    expect(events[0].confidence).toBe('confirmed');
    expect(events[0].metadata.fallback_html_match).toContain('January 28-29, 2026');
  });

  test('runIngest falls back to html when json feed fails', async () => {
    helpers.httpGetJson.mockRejectedValue(new Error('json failed'));
    helpers.httpGetText.mockResolvedValue('Meeting calendars and information January 28-29, 2026');

    const result = await runIngest({ dryRun: true });

    expect(result.source).toBe('html_fallback');
    expect(result.candidateEvents).toBe(1);
    expect(helpers.upsertEvents).toHaveBeenCalledTimes(1);
  });
});