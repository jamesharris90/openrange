const {
  deriveCatalystSignal,
  scoreCatalyst,
  scoreGap,
  scoreVolume,
  scoreStructure,
  scoreRegime,
  computeCompositeScore,
} = require('../scoring');

describe('premarket-catalyst scoring', () => {
  test('scoreCatalyst returns 100 for earnings and strong news catalysts', () => {
    expect(scoreCatalyst({
      earningsEvents: [{ report_date: '2026-05-04', report_time: 'amc' }],
      now: new Date('2026-05-04T12:00:00.000Z'),
    })).toBe(100);

    expect(scoreCatalyst({
      newsArticles: [{ headline: 'Company receives FDA approval for lead therapy', published_at: '2026-05-04T10:00:00.000Z' }],
      now: new Date('2026-05-04T12:00:00.000Z'),
    })).toBe(100);
  });

  test('scoreCatalyst handles analyst and unrecognized catalysts', () => {
    expect(scoreCatalyst({
      newsArticles: [{ headline: 'Broker upgrades shares to buy', published_at: '2026-05-04T10:00:00.000Z' }],
      now: new Date('2026-05-04T12:00:00.000Z'),
    })).toBe(70);

    expect(scoreCatalyst({
      newsArticles: [{ headline: 'Company mentioned in sector roundup', catalyst_type: 'sector_news', published_at: '2026-05-04T10:00:00.000Z' }],
      now: new Date('2026-05-04T12:00:00.000Z'),
    })).toBe(40);

    expect(scoreCatalyst({ newsArticles: [], secFilings: [], earningsEvents: [], now: new Date('2026-05-04T12:00:00.000Z') })).toBe(0);
  });

  test('deriveCatalystSignal returns details for the strongest catalyst', () => {
    const signal = deriveCatalystSignal({
      newsArticles: [{ headline: 'Company signs major contract worth $2B', published_at: '2026-05-04T11:00:00.000Z' }],
      secFilings: [{ form_type: '8-K', accepted_date: '2026-05-04T10:00:00.000Z' }],
      now: new Date('2026-05-04T12:00:00.000Z'),
    });

    expect(signal.score).toBe(100);
    expect(signal.type).toBe('contract');
  });

  test('scoreGap respects key anchor values and invalid inputs', () => {
    expect(scoreGap({ premarketPrice: 108, previousClose: 100 })).toBe(100);
    expect(scoreGap({ premarketPrice: 104, previousClose: 100 })).toBe(60);
    expect(scoreGap({ premarketPrice: 115, previousClose: 100 })).toBe(65);
    expect(scoreGap({ premarketPrice: 125, previousClose: 100 })).toBe(25);
    expect(scoreGap({ premarketPrice: 101, previousClose: 100 })).toBe(0);
    expect(scoreGap({ premarketPrice: null, previousClose: 100 })).toBe(0);
  });

  test('scoreVolume respects rvol thresholds and missing baseline', () => {
    expect(scoreVolume({ premarketVolume: 100000, premarketVolumeBaseline: 100000 })).toBe(0);
    expect(scoreVolume({ premarketVolume: 200000, premarketVolumeBaseline: 100000 })).toBe(30);
    expect(scoreVolume({ premarketVolume: 300000, premarketVolumeBaseline: 100000 })).toBe(50);
    expect(scoreVolume({ premarketVolume: 500000, premarketVolumeBaseline: 100000 })).toBe(75);
    expect(scoreVolume({ premarketVolume: 1000000, premarketVolumeBaseline: 100000 })).toBe(100);
    expect(scoreVolume({ premarketVolume: 100000, premarketVolumeBaseline: null })).toBe(0);
  });

  test('scoreStructure handles strong mixed and weak setups', () => {
    const strongBars = [
      { low: 10.0 },
      { low: 10.1 },
      { low: 10.2 },
      { low: 10.3 },
      { low: 10.4 },
    ];
    expect(scoreStructure({ premarketBars: strongBars, premarketHigh: 11, premarketVwap: 10.5, currentPrice: 10.95 })).toBe(100);
    expect(scoreStructure({ premarketBars: strongBars, premarketHigh: 11, premarketVwap: 10.5, currentPrice: 10.8 })).toBe(70);
    expect(scoreStructure({ premarketBars: strongBars, premarketHigh: 11, premarketVwap: 10.5, currentPrice: 10.55 })).toBe(50);
    expect(scoreStructure({ premarketBars: strongBars, premarketHigh: 11, premarketVwap: 10.5, currentPrice: 10.49 })).toBe(30);
    expect(scoreStructure({ premarketBars: strongBars, premarketHigh: 11, premarketVwap: 10.5, currentPrice: 10.1 })).toBe(0);
  });

  test('scoreRegime handles risk_on neutral and risk_off', () => {
    const marketContext = {
      marketRegime: 'risk_on',
      sectors: {
        XLK: { rank: 1, changePercent: 1 },
        XLE: { rank: 11, changePercent: -1 },
      },
    };

    expect(scoreRegime({ marketContext, ticker: { sectorSymbol: 'XLK' } })).toBe(100);
    expect(scoreRegime({ marketContext: { marketRegime: 'neutral', sectors: { XLE: { rank: 5, changePercent: -0.2 } } }, ticker: { sectorSymbol: 'XLE' } })).toBe(50);
    expect(scoreRegime({ marketContext: { marketRegime: 'risk_off', sectors: { XLE: { rank: 11, changePercent: -1 }, XLK: { rank: 1, changePercent: 1 }, XLF: { rank: 2, changePercent: 0.5 } } }, ticker: { sectorSymbol: 'XLE' } })).toBe(0);
  });

  test('computeCompositeScore respects fixed weights', () => {
    expect(computeCompositeScore({ catalystScore: 100, gapScore: 100, volumeScore: 100, structureScore: 100, regimeScore: 100 })).toBe(100);
    expect(computeCompositeScore({ catalystScore: 70, gapScore: 60, volumeScore: 50, structureScore: 40, regimeScore: 30 })).toBeCloseTo(54.5, 5);
  });
});
