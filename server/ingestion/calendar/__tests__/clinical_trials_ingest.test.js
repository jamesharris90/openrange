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
  flagSystemHealth: jest.fn(),
  httpGetJson: jest.fn(),
  runCalendarJob: jest.fn(async (_jobName, fn) => fn()),
  upsertEvents: jest.fn(),
}));

const helpers = require('../_helpers');
const {
  normalizeClinicalTrialsDate,
  normalizeStudy,
  runIngest,
} = require('../clinical_trials_ingest');

describe('clinical_trials_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 2, updated: 0, dryRun: true });
  });

  test('normalizeClinicalTrialsDate keeps full dates unchanged', () => {
    expect(normalizeClinicalTrialsDate('2026-08-15')).toBe('2026-08-15');
  });

  test('normalizeClinicalTrialsDate expands year-month to month end', () => {
    expect(normalizeClinicalTrialsDate('2028-02')).toBe('2028-02-29');
    expect(normalizeClinicalTrialsDate('2028-01')).toBe('2028-01-31');
  });

  test('normalizeClinicalTrialsDate expands year-only to december 31', () => {
    expect(normalizeClinicalTrialsDate('2028')).toBe('2028-12-31');
  });

  test('normalizeStudy extracts completion date and sponsor metadata', () => {
    const event = normalizeStudy({
      protocolSection: {
        identificationModule: { nctId: 'NCT123', briefTitle: 'Phase 3 Trial' },
        statusModule: { completionDateStruct: { date: '2026-08-15', type: 'ACTUAL' }, overallStatus: 'RECRUITING' },
        sponsorCollaboratorsModule: { leadSponsor: { name: 'Open Range Bio' } },
        designModule: { phases: ['PHASE3'] },
      },
    });

    expect(event.source_id).toBe('NCT123');
    expect(event.event_date).toBe('2026-08-15');
    expect(event.confidence).toBe('confirmed');
    expect(event.metadata.sponsor_name).toBe('Open Range Bio');
    expect(event.metadata.completion_date_raw).toBe('2026-08-15');
  });

  test('normalizeStudy marks anticipated dates as estimated', () => {
    const event = normalizeStudy({
      protocolSection: {
        identificationModule: { nctId: 'NCT999', briefTitle: 'Phase 3 Trial' },
        statusModule: { completionDateStruct: { date: '2028-01', type: 'ANTICIPATED' } },
      },
    });

    expect(event.event_date).toBe('2028-01-31');
    expect(event.confidence).toBe('estimated');
  });

  test('runIngest paginates and truncates to maxStudies', async () => {
    helpers.httpGetJson
      .mockResolvedValueOnce({
        studies: [{
          protocolSection: {
            identificationModule: { nctId: 'NCT123', briefTitle: 'Trial 1' },
            statusModule: { completionDateStruct: { date: '2026-08-15' } },
          },
        }],
        nextPageToken: 'next',
      })
      .mockResolvedValueOnce({
        studies: [{
          protocolSection: {
            identificationModule: { nctId: 'NCT124', briefTitle: 'Trial 2' },
            statusModule: { completionDateStruct: { date: '2026-09-01' } },
          },
        }],
      });

    const result = await runIngest({ dryRun: true, maxStudies: 2 });

    expect(helpers.httpGetJson).toHaveBeenCalledTimes(2);
    expect(result.fetched).toBe(2);
    expect(result.candidateEvents).toBe(2);
  });

  test('runIngest skips malformed dates and logs a parse_error system flag', async () => {
    helpers.httpGetJson.mockResolvedValueOnce({
      studies: [{
        protocolSection: {
          identificationModule: { nctId: 'NCTBAD', briefTitle: 'Broken Trial' },
          statusModule: { completionDateStruct: { date: 'garbage' } },
        },
      }],
    });

    const result = await runIngest({ dryRun: true, maxStudies: 10 });

    expect(result.candidateEvents).toBe(0);
    expect(helpers.flagSystemHealth).toHaveBeenCalledWith(
      'clinicaltrials_gov',
      'parse_error',
      'warning',
      expect.stringContaining('ClinicalTrials malformed completion date for NCTBAD'),
      expect.objectContaining({ nct_id: 'NCTBAD', completion_date_raw: 'garbage' })
    );
  });
});