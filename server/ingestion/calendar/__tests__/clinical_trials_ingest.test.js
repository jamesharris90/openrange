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
const { normalizeStudy, runIngest } = require('../clinical_trials_ingest');

describe('clinical_trials_ingest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helpers.upsertEvents.mockResolvedValue({ inserted: 2, updated: 0, dryRun: true });
  });

  test('normalizeStudy extracts completion date and sponsor metadata', () => {
    const event = normalizeStudy({
      protocolSection: {
        identificationModule: { nctId: 'NCT123', briefTitle: 'Phase 3 Trial' },
        statusModule: { completionDateStruct: { date: '2026-08-15', type: 'ESTIMATED' }, overallStatus: 'RECRUITING' },
        sponsorCollaboratorsModule: { leadSponsor: { name: 'Open Range Bio' } },
        designModule: { phases: ['PHASE3'] },
      },
    });

    expect(event.source_id).toBe('NCT123');
    expect(event.event_date).toBe('2026-08-15');
    expect(event.metadata.sponsor_name).toBe('Open Range Bio');
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
});