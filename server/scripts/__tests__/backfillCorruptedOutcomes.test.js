'use strict';

jest.mock('../../beacon-v0/outcomes/priceLookup', () => ({
  lookupPrice: jest.fn(),
}));

const { lookupPrice } = require('../../beacon-v0/outcomes/priceLookup');
const {
  computeStatusFromCaptures,
  repairRow,
} = require('../backfillCorruptedOutcomes');

function buildPick(overrides = {}) {
  return {
    id: 42,
    symbol: 'TEST',
    pick_price: 10,
    pick_volume_baseline: 100,
    created_at: '2026-04-25T22:00:00.000Z',
    discovered_in_window: 'nightly',
    outcome_status: 'corrupted',
    outcome_complete: true,
    outcome_t1_captured_at: null,
    outcome_t2_captured_at: null,
    outcome_t3_captured_at: null,
    outcome_t4_captured_at: null,
    outcome_t1_price: null,
    outcome_t2_price: null,
    outcome_t3_price: null,
    outcome_t4_price: null,
    ...overrides,
  };
}

describe('backfillCorruptedOutcomes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('all four recovered checkpoints mark row complete', async () => {
    lookupPrice
      .mockResolvedValueOnce({ price: 11, volume: 120, captured_at: new Date('2026-04-27T14:30:00.000Z') })
      .mockResolvedValueOnce({ price: 12, volume: 150, captured_at: new Date('2026-04-27T20:00:00.000Z') })
      .mockResolvedValueOnce({ price: 13, volume: 160, captured_at: new Date('2026-04-28T13:30:00.000Z') })
      .mockResolvedValueOnce({ price: 14, volume: 200, captured_at: new Date('2026-04-28T20:00:00.000Z') });

    const result = await repairRow({ query: jest.fn() }, buildPick(), { isDryRun: true });

    expect(result.afterStatus).toBe('complete');
    expect(result.totalCaptures).toBe(4);
    expect(result.updates.outcome_complete).toBe(true);
    expect(result.updates.outcome_t4_pct_change).toBeCloseTo(40);
    expect(result.updates.outcome_t1_volume_ratio).toBeCloseTo(1.2);
  });

  test('two recovered checkpoints remain partial', async () => {
    lookupPrice
      .mockResolvedValueOnce({ price: 11, volume: 120, captured_at: new Date('2026-04-27T14:30:00.000Z') })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ price: 9, volume: 90, captured_at: new Date('2026-04-28T13:30:00.000Z') })
      .mockResolvedValueOnce(null);

    const result = await repairRow({ query: jest.fn() }, buildPick(), { isDryRun: true });

    expect(result.afterStatus).toBe('partial');
    expect(result.capturesRecovered).toBe(2);
    expect(result.updates.outcome_complete).toBe(false);
    expect(result.updates.outcome_t3_pct_change).toBeCloseTo(-10);
  });

  test('no recovered checkpoints become errored', async () => {
    lookupPrice.mockResolvedValue(null);

    const result = await repairRow({ query: jest.fn() }, buildPick(), { isDryRun: true });

    expect(result.afterStatus).toBe('errored');
    expect(result.capturesRecovered).toBe(0);
    expect(result.updates.outcome_complete).toBe(false);
  });

  test('existing captures are preserved and not re-fetched', async () => {
    lookupPrice
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ price: 13, volume: 160, captured_at: new Date('2026-04-28T13:30:00.000Z') })
      .mockResolvedValueOnce({ price: 14, volume: 200, captured_at: new Date('2026-04-28T20:00:00.000Z') });

    const result = await repairRow(
      { query: jest.fn() },
      buildPick({
        outcome_status: 'partial',
        outcome_t1_captured_at: new Date('2026-04-27T14:30:00.000Z'),
        outcome_t1_price: 11,
      }),
      { isDryRun: true },
    );

    expect(lookupPrice).toHaveBeenCalledTimes(3);
    expect(result.existingCaptures).toBe(1);
    expect(result.afterStatus).toBe('partial');
  });

  test('computeStatusFromCaptures returns errored when nothing is captured', () => {
    expect(computeStatusFromCaptures(buildPick(), {})).toBe('errored');
  });
});