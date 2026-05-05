jest.mock('../../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

const { queryWithTimeout } = require('../../db/pg');
const signal = require('../signals/top_smart_money_today');

describe('top_smart_money_today', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('headline synthesis summarizes core smart money factors', () => {
    const headline = signal.synthesizeHeadline({
      insider_buy_count: 3,
      insider_net_value: 1200000,
      congressional_member_count: 2,
      institutional_new_positions: 1,
      activist_filing_count: 1,
    });

    expect(headline).toContain('3 insiders bought $1.2M');
    expect(headline).toContain('2 congressional members');
    expect(headline).toContain('1 new 13F position');
  });

  test('detect returns result map with smart money metadata', async () => {
    queryWithTimeout.mockResolvedValue({
      rows: [{
        symbol: 'AAPL',
        score_date: '2026-05-05',
        total_score: 67,
        score_tier: 'high',
        insider_component: 24,
        insider_net_value: 1200000,
        insider_buy_count: 3,
        congressional_component: 10,
        congressional_member_count: 2,
        institutional_component: 25,
        institutional_new_positions: 1,
        activist_component: 8,
        activist_filing_count: 1,
        contributing_factors: { insider: [], congressional: [], institutional: [], activist: [] },
      }],
    });

    const results = await signal.detect();
    const item = results.get('AAPL');
    expect(item.signal).toBe(signal.SIGNAL_NAME);
    expect(item.cluster).toBe('SMART_MONEY');
    expect(item.metadata.total_score).toBe(67);
    expect(item.reasoning).toContain('insider');
  });
});