jest.mock('../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { queryWithTimeout } = require('../db/pg');
const { computeImportance, upsertEvent } = require('../ingestion/calendar/_helpers');
const {
  detect,
  synthesizeHeadline,
} = require('../beacon-v0/signals/top_imminent_catalysts_today');

describe('event calendar helpers and signal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('computeImportance adjusts recall severity and IPO size', () => {
    expect(computeImportance('DRUG_RECALL', { classification: 'Class I' })).toBe(10);
    expect(computeImportance('IPO', { marketCap: 1500000000 })).toBe(9);
  });

  test('upsertEvent returns normalized payload in dry run mode', async () => {
    const result = await upsertEvent({
      event_type: 'IPO',
      event_date: '2026-06-01T09:30:00Z',
      symbol: 'aapl',
      title: 'AAPL IPO',
      source: 'FMP',
      metadata: { marketCap: 1500000000 },
    }, null, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.inserted).toBe(0);
    expect(result.event.event_date).toBe('2026-06-01');
    expect(result.event.symbol).toBe('AAPL');
    expect(result.event.importance).toBe(9);
  });

  test('detect maps imminent catalyst rows into a symbol keyed result map', async () => {
    queryWithTimeout.mockResolvedValue({
      rows: [{
        symbol: 'AAPL',
        event_type: 'IPO',
        event_date: '2026-06-05',
        title: 'AAPL investor day',
        description: 'Product roadmap update',
        source: 'manual',
        importance: 8,
        confidence: 'confirmed',
        days_until_event: 2,
        score: '6.4',
        metadata: { category: 'conference' },
      }],
    });

    const results = await detect(['aapl'], { topN: 5 });
    const item = results.get('AAPL');

    expect(queryWithTimeout).toHaveBeenCalledTimes(1);
    expect(results.size).toBe(1);
    expect(item.cluster).toBe('IMMINENT_CATALYST');
    expect(item.score).toBe(6.4);
    expect(item.metadata.days_until_event).toBe(2);
    expect(item.headline).toBe('AAPL investor day in 2 days; Product roadmap update');
  });

  test('detect binds populated universe filters to parameter $2', async () => {
    queryWithTimeout.mockResolvedValue({ rows: [] });

    await detect(['aapl'], { topN: 5 });

    expect(queryWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('AND UPPER(symbol) = ANY($2::text[])'),
      [5, ['AAPL']],
      expect.objectContaining({
        label: 'beacon_v0.signal.top_imminent_catalysts_today',
      }),
    );
  });

  test('synthesizeHeadline handles same-day events', () => {
    expect(synthesizeHeadline({
      title: 'Fed meeting',
      description: 'Rate decision',
      days_until_event: 0,
    })).toBe('Fed meeting today; Rate decision');
  });
});