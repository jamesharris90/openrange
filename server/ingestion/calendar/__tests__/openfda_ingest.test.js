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
const { buildSpikeEvents, normalizeRecall, runIngest } = require('../openfda_ingest');

describe('openfda_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 2, updated: 0, dryRun: true });
  });

  test('normalizeRecall maps recall severity and title', () => {
    const event = normalizeRecall({
      report_date: '2026-05-01',
      classification: 'Class I',
      product_description: 'Drug X',
      reason_for_recall: 'Contamination',
      recall_number: 'R-1',
    });

    expect(event.event_type).toBe('DRUG_RECALL');
    expect(event.importance).toBe(10);
    expect(event.title).toContain('Drug X');
  });

  test('buildSpikeEvents groups repeated brands over threshold', () => {
    const results = buildSpikeEvents([
      { patient: { drug: [{ medicinalproduct: 'Drug X' }] }, receiptdate: '20260501' },
      { patient: { drug: [{ medicinalproduct: 'Drug X' }] }, receiptdate: '20260502' },
      { patient: { drug: [{ medicinalproduct: 'Drug X' }] }, receiptdate: '20260503' },
    ], 2);

    expect(results).toHaveLength(1);
    expect(results[0].metadata.report_count).toBe(3);
  });

  test('runIngest persists recalls and spike events', async () => {
    helpers.httpGetJson
      .mockResolvedValueOnce({ results: [{ patient: { drug: [{ medicinalproduct: 'Drug X' }] }, receiptdate: '20260501' }] })
      .mockResolvedValueOnce({ results: [{ report_date: '2026-05-01', classification: 'Class II', product_description: 'Drug X', reason_for_recall: 'Labeling', recall_number: 'R-2' }] });

    const result = await runIngest({ dryRun: true, spikeThreshold: 0 });

    expect(helpers.httpGetJson).toHaveBeenCalledTimes(2);
    expect(result.recallCount).toBe(1);
    expect(result.spikeCount).toBe(1);
  });
});