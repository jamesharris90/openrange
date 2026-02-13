import { hardGate } from '../scoring/gating';
import { ThresholdConfig } from '../models/types';

const thresholds: ThresholdConfig = {
  minPrice: 1,
  maxPrice: 500,
  minAvgVolume: 500000,
  minPmVolume: 100000,
  minGapPct: 3,
};

describe('hardGate', () => {
  test('rejects null catalyst', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      null,
      thresholds,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('catalyst');
  });

  test('rejects catalyst type "none"', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'none', detail: 'nothing' },
      thresholds,
    );
    expect(result.pass).toBe(false);
  });

  test('rejects "no clear catalyst" in detail text', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'general', detail: 'No clear catalyst found' },
      thresholds,
    );
    expect(result.pass).toBe(false);
  });

  test('rejects "no identifiable catalyst" phrase', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'general', detail: 'No identifiable catalyst — drifting on low volume' },
      thresholds,
    );
    expect(result.pass).toBe(false);
  });

  test('rejects missing price', () => {
    const result = hardGate(
      { ticker: 'T', avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('price');
  });

  test('rejects price below minimum', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 0.50, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Price');
  });

  test('rejects price above maximum', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 600, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(false);
  });

  test('rejects insufficient average volume', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 200000, pmVolume: 200000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Average volume');
  });

  test('rejects insufficient PM volume', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 50000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('PM volume');
  });

  test('rejects gap below threshold', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 1.5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Gap');
  });

  test('accepts negative gap that exceeds threshold in absolute value', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: -5 },
      { type: 'earnings', detail: 'miss' },
      thresholds,
    );
    expect(result.pass).toBe(true);
  });

  test('rejects float exceeding maxFloat when set', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5, float: 500000000 },
      { type: 'earnings', detail: 'beat' },
      { ...thresholds, maxFloat: 200000000 },
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('Float');
  });

  test('passes when all criteria met', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('uses last price when pmPrice is missing', () => {
    const result = hardGate(
      { ticker: 'T', last: 10, avgVolume: 1e6, pmVolume: 200000, pmChangePct: 5 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(true);
  });

  test('skips gap check when pmChangePct is undefined', () => {
    const result = hardGate(
      { ticker: 'T', pmPrice: 10, avgVolume: 1e6, pmVolume: 200000 },
      { type: 'earnings', detail: 'beat' },
      thresholds,
    );
    expect(result.pass).toBe(true);
  });
});
