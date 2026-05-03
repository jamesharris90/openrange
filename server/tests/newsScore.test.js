const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: false,
});

const { scoreNewsItem } = require('../services/newsEngineV3');

describe('news scoring v3', () => {
  const nowTs = new Date('2026-02-23T18:30:00.000Z').getTime();

  test('Test 1: high-impact phrase contributes 10 points', () => {
    const scored = scoreNewsItem({
      symbol: 'AAPL',
      headline: 'Company X Beats Earnings Expectations',
      text: '',
      source: 'Reuters',
      publishedAt: '2026-02-23T18:00:00.000Z',
      payloadSymbol: 'AAPL',
      nowTs,
    });

    expect(scored.scoreBreakdown.keyword_score).toBeGreaterThanOrEqual(10);
  });

  test('Test 2: additive keyword scoring sums matched clusters', () => {
    const scored = scoreNewsItem({
      symbol: 'AAPL',
      headline: 'Company X Beats Expectations and Raises Guidance',
      text: '',
      source: 'MarketWatch',
      publishedAt: '2026-02-23T17:00:00.000Z',
      payloadSymbol: 'AAPL',
      nowTs,
    });

    expect(scored.scoreBreakdown.keyword_score).toBeGreaterThanOrEqual(20);
  });

  test('Test 3: opinion-style headline remains low score', () => {
    const scored = scoreNewsItem({
      symbol: '',
      headline: 'Should You Buy Company X Now?',
      text: '',
      source: 'Unknown Source',
      publishedAt: '2026-02-20T00:00:00.000Z',
      payloadSymbol: '',
      nowTs,
    });

    expect(scored.newsScore).toBeLessThan(10);
  });

  test('Test 4: FDA approval headline gets high-impact keyword points', () => {
    const scored = scoreNewsItem({
      symbol: 'AAPL',
      headline: 'Company X Receives FDA Approval',
      text: '',
      source: 'Bloomberg',
      publishedAt: '2026-02-23T15:00:00.000Z',
      payloadSymbol: 'AAPL',
      nowTs,
    });

    expect(scored.scoreBreakdown.keyword_score).toBeGreaterThanOrEqual(10);
  });

  test('Test 5: analyst boost applies when upgrade/raises and buy/outperform both appear', () => {
    const scored = scoreNewsItem({
      symbol: 'AAPL',
      headline: 'Broker Upgrade Raises Target and Reiterates Buy Outperform on Company X',
      text: '',
      source: 'Reuters',
      publishedAt: '2026-02-23T18:00:00.000Z',
      payloadSymbol: 'AAPL',
      nowTs,
    });

    expect(scored.scoreBreakdown.analyst_boost_score).toBe(6);
  });
});
