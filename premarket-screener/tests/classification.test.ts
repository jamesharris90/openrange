import { classify } from '../scoring/classification';
import { EnrichedTicker } from '../models/types';

function makeTicker(overrides: Partial<EnrichedTicker>): EnrichedTicker {
  return {
    ticker: 'TEST',
    pmPrice: 10,
    pmChangePct: 6,
    pmVolume: 200000,
    avgVolume: 500000,
    float: 10000000,
    catalyst: { type: 'product', detail: 'Launch' },
    relVolume: 2,
    levels: { pmHigh: 10.2, pmLow: 9.5 },
    ...overrides,
  };
}

describe('classify', () => {
  describe('Class A — Momentum Continuation', () => {
    test('assigns A with major catalyst, rel vol ≥1.5, gap ≥5%, holding PM highs', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'earnings', detail: 'Big beat' },
        relVolume: 2.0,
        pmChangePct: 8,
        pmPrice: 10.1,
        levels: { pmHigh: 10.2, pmLow: 9.5 },
      }));
      expect(out.classification).toBe('A');
      expect(out.permittedStrategies).toContain('Strategy 1 (ORB)');
      expect(out.permittedStrategies).toContain('Strategy 4 (Momentum Extension)');
      expect(out.conviction).toBe('HIGH');
    });

    test('does NOT assign A when not holding PM highs', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'earnings', detail: 'Big beat' },
        relVolume: 2.0,
        pmChangePct: 8,
        pmPrice: 9.0,  // well below PM high of 10.2
        levels: { pmHigh: 10.2, pmLow: 9.5 },
      }));
      expect(out.classification).not.toBe('A');
    });

    test('does NOT assign A with relVol below 1.5', () => {
      const out = classify(makeTicker({
        relVolume: 1.2,
        pmChangePct: 8,
        pmPrice: 10.1,
      }));
      expect(out.classification).not.toBe('A');
    });

    test('does NOT assign A when gap below 5%', () => {
      const out = classify(makeTicker({
        relVolume: 2.0,
        pmChangePct: 4,
        pmPrice: 10.1,
      }));
      expect(out.classification).not.toBe('A');
    });
  });

  describe('Class B — Fresh News / Day-1 Volatility', () => {
    test('assigns B with valid catalyst, relVol ≥1, gap ≥3%', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'sector', detail: 'Sector rotation' },
        relVolume: 1.2,
        pmChangePct: 4,
        pmPrice: 9.0,
      }));
      expect(out.classification).toBe('B');
      expect(out.permittedStrategies).toContain('Strategy 1 (ORB)');
      expect(out.permittedStrategies).toContain('Strategy 2 (Support Bounce)');
      expect(out.permittedStrategies).toContain('Strategy 3 (VWAP Reclaim)');
      expect(out.conviction).toBe('MEDIUM');
    });

    test('accepts negative gap for B if catalyst is valid and not offering', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'fda', detail: 'Phase 2 miss' },
        relVolume: 1.5,
        pmChangePct: -6,
      }));
      expect(out.classification).toBe('B');
    });
  });

  describe('Class C — Reversal Watchlist', () => {
    test('assigns C to offering + negative gap (selloff)', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'offering', detail: '$1B offering' },
        relVolume: 2.0,
        pmChangePct: -10,
      }));
      expect(out.classification).toBe('C');
      expect(out.permittedStrategies).toContain('Strategy 3 (VWAP Reclaim)');
      expect(out.permittedStrategies).toContain('Strategy 5 (Post-Flush Reclaim)');
      expect(out.conviction).toBe('LOW');
    });

    test('assigns C when relVol insufficient despite valid catalyst', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'upgrade', detail: 'PT raised' },
        relVolume: 0.5,
        pmChangePct: 4,
      }));
      expect(out.classification).toBe('C');
    });

    test('assigns C when catalyst is weak (general type)', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'general', detail: 'Nothing notable' },
        relVolume: 0.3,
        pmChangePct: 1,
      }));
      expect(out.classification).toBe('C');
    });

    test('conditionalNote says OBSERVE ONLY for C', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'general', detail: 'Nothing' },
        relVolume: 0.3,
        pmChangePct: 1,
      }));
      expect(out.conditionalNote).toContain('OBSERVE ONLY');
    });
  });

  describe('Strategy mapping correctness', () => {
    test('Class A only permits Strategy 1 and 4', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'fda', detail: 'Approval' },
        relVolume: 3.0,
        pmChangePct: 15,
        pmPrice: 10.2,
        levels: { pmHigh: 10.2, pmLow: 9.5 },
      }));
      expect(out.permittedStrategies).toEqual(['Strategy 1 (ORB)', 'Strategy 4 (Momentum Extension)']);
    });

    test('Class C only permits Strategy 3 and 5', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'offering', detail: 'Dilution' },
        relVolume: 1.0,
        pmChangePct: -8,
      }));
      expect(out.permittedStrategies).toEqual(['Strategy 3 (VWAP Reclaim)', 'Strategy 5 (Post-Flush Reclaim)']);
    });
  });

  describe('Invalidation / Risk', () => {
    test('invalidation references PM low when available', () => {
      const out = classify(makeTicker({ levels: { pmHigh: 10.2, pmLow: 9.50 } }));
      expect(out.invalidation).toContain('9.50');
    });

    test('invalidation falls back to prev close when PM low missing', () => {
      const out = classify(makeTicker({ levels: { prevClose: 9.00 } }));
      expect(out.invalidation).toContain('9.00');
    });

    test('Class C gets knife risk', () => {
      const out = classify(makeTicker({
        catalyst: { type: 'offering', detail: 'Dilution' },
        relVolume: 1.0,
        pmChangePct: -8,
      }));
      expect(out.primaryRisk).toContain('Knife');
    });
  });
});
