const {
  classifyLabel,
  generateRiskFlags,
  deriveStructureType,
  deriveTradeState,
  generateWhy,
} = require('../labelClassifier');

describe('premarket-catalyst labelClassifier', () => {
  test('A label requires all conditions and no critical risk flags', () => {
    expect(classifyLabel({
      score: 78,
      components: { catalystScore: 80, volumeScore: 60, structureScore: 75 },
      riskFlags: [],
    })).toBe('A');
  });

  test('critical risk flags downgrade an otherwise strong setup', () => {
    expect(classifyLabel({
      score: 78,
      components: { catalystScore: 80, volumeScore: 60, structureScore: 75 },
      riskFlags: ['offering_in_24h'],
    })).toBe('C');
  });

  test('B label triggers correctly and C is the default', () => {
    expect(classifyLabel({
      score: 55,
      components: { catalystScore: 55, volumeScore: 52, structureScore: 40 },
      riskFlags: [],
    })).toBe('B');

    expect(classifyLabel({
      score: 32,
      components: { catalystScore: 20, volumeScore: 45, structureScore: 35 },
      riskFlags: [],
    })).toBe('C');
  });

  test('generateRiskFlags fires on defined conditions', () => {
    const flags = generateRiskFlags({
      metrics: {
        gapPercent: 26,
        currentPrice: 9.5,
        premarketHigh: 10,
        premarketVolume: 40000,
        sectorRank: 11,
        catalystScore: 20,
        floatShares: 4000000,
        marketCap: 50000000,
        baselineDays: 5,
      },
      secFilings: [{ form_type: '424B5' }],
      marketContext: {
        sectors: {
          XLK: { rank: 1 },
          XLF: { rank: 2 },
          XLE: { rank: 3 },
          XLI: { rank: 4 },
          XLV: { rank: 5 },
          XLP: { rank: 6 },
          XLY: { rank: 7 },
          XLB: { rank: 8 },
          XLU: { rank: 9 },
          XLRE: { rank: 10 },
          XLC: { rank: 11 },
        },
      },
    });

    expect(flags).toEqual(expect.arrayContaining([
      'gap_too_extended',
      'fading_from_high',
      'low_premarket_volume',
      'sector_strongly_against',
      'no_catalyst',
      'offering_in_24h',
      'low_float',
      'micro_market_cap',
      'insufficient_baseline',
    ]));
  });

  test('deriveStructureType covers each named structure', () => {
    expect(deriveStructureType({ components: { catalystScore: 80, gapScore: 70, volumeScore: 60 }, metrics: { aboveVwap: true, nearHigh: true, last15VolumeShare: 0.2 } })).toBe('Catalyst Gap & Hold');
    expect(deriveStructureType({ components: { catalystScore: 80, gapScore: 70, volumeScore: 60 }, metrics: { aboveVwap: false, nearHigh: false, last15VolumeShare: 0.2 } })).toBe('Catalyst Gap & Fade');
    expect(deriveStructureType({ components: { catalystScore: 20, gapScore: 30, volumeScore: 80 }, metrics: { aboveVwap: false, nearHigh: false, last15VolumeShare: 0.2 } })).toBe('High Volume No Catalyst');
    expect(deriveStructureType({ components: { catalystScore: 20, gapScore: 30, volumeScore: 55 }, metrics: { aboveVwap: false, nearHigh: false, last15VolumeShare: 0.5 } })).toBe('Late Premarket Ignition');
    expect(deriveStructureType({ components: { catalystScore: 45, gapScore: 30, volumeScore: 20 }, metrics: { aboveVwap: true, nearHigh: false, last15VolumeShare: 0.1 } })).toBe('Mixed Signals');
    expect(deriveStructureType({ components: { catalystScore: 10, gapScore: 10, volumeScore: 10 }, metrics: { aboveVwap: false, nearHigh: false, last15VolumeShare: 0.1 } })).toBe('Weak Setup');
  });

  test('deriveTradeState covers each label path', () => {
    expect(deriveTradeState({ label: 'A', structureType: 'Catalyst Gap & Hold' })).toBe('watch_for_orb');
    expect(deriveTradeState({ label: 'A', structureType: 'Mixed Signals' })).toBe('monitor');
    expect(deriveTradeState({ label: 'B', structureType: 'Mixed Signals' })).toBe('monitor');
    expect(deriveTradeState({ label: 'C', structureType: 'Weak Setup' })).toBe('skip');
  });

  test('generateWhy returns concise non-empty reasons', () => {
    const why = generateWhy({
      components: { catalystScore: 80 },
      metrics: { gapPercent: 8.2, rvol: 4.6, aboveVwap: true, nearHigh: true },
      context: { catalyst: { summary: 'Recent 8-K filing' }, marketRegime: 'risk_on' },
      structureType: 'Catalyst Gap & Hold',
    });

    expect(why.length).toBeGreaterThan(0);
    expect(why.length).toBeLessThanOrEqual(5);
  });
});