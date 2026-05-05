jest.mock('../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

const {
  calculateActivistComponent,
  calculateCongressionalComponent,
  calculateInstitutionalComponent,
  calculateInsiderComponent,
  scoreTier,
} = require('../services/smartMoneyScoreEngine');

describe('smartMoneyScoreEngine', () => {
  test('insider component rewards buys, C-suite, and cluster', () => {
    const result = calculateInsiderComponent([
      { reporting_cik: '1', reporting_name: 'A', type_of_owner: 'CEO', transaction_type: 'P-Purchase', transaction_date: '2026-05-01', total_value: 100000 },
      { reporting_cik: '2', reporting_name: 'B', type_of_owner: 'Director', transaction_type: 'P-Purchase', transaction_date: '2026-05-02', total_value: 200000 },
      { reporting_cik: '3', reporting_name: 'C', type_of_owner: 'COO', transaction_type: 'P-Purchase', transaction_date: '2026-05-03', total_value: 300000 },
    ]);

    expect(result.component).toBe(40);
    expect(result.insider_buy_count).toBe(3);
    expect(result.insider_sell_count).toBe(0);
  });

  test('insider component caps sell penalty', () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      reporting_cik: String(index),
      reporting_name: `Seller ${index}`,
      transaction_type: 'S-Sale',
      transaction_date: '2026-05-01',
      total_value: 1000,
    }));
    const result = calculateInsiderComponent(rows);
    expect(result.component).toBe(0);
    expect(result.insider_sell_count).toBe(5);
  });

  test('congressional component scores member count and cluster', () => {
    const result = calculateCongressionalComponent([
      { member_first_name: 'A', member_last_name: 'One', chamber: 'Senate', transaction_type: 'Purchase', disclosure_date: '2026-05-01', amount_min_usd: 10000 },
      { member_first_name: 'B', member_last_name: 'Two', chamber: 'House', transaction_type: 'Purchase', disclosure_date: '2026-05-02', amount_min_usd: 20000 },
      { member_first_name: 'C', member_last_name: 'Three', chamber: 'House', transaction_type: 'Purchase', disclosure_date: '2026-05-03', amount_min_usd: 30000 },
    ], { clusterWindowStart: '2026-04-25' });

    expect(result.component).toBe(20);
    expect(result.congressional_member_count).toBe(3);
  });

  test('congressional component adds conviction bonus for larger disclosed trade tiers', () => {
    const result = calculateCongressionalComponent([
      { member_first_name: 'A', member_last_name: 'One', chamber: 'Senate', transaction_type: 'Purchase', disclosure_date: '2026-05-01', amount_min_usd: 75000 },
      { member_first_name: 'B', member_last_name: 'Two', chamber: 'House', transaction_type: 'Purchase', disclosure_date: '2026-05-02', amount_min_usd: 10000 },
    ], { clusterWindowStart: '2026-04-25' });

    expect(result.component).toBe(15);
    expect(result.congressional_net_value).toBe(85000);
  });

  test('institutional component scores new, increased, major, and closed positions', () => {
    const result = calculateInstitutionalComponent([
      { investor_name: 'Fund A', is_new_position: true, is_sold_out: false, shares_change_pct: 60, market_value: 200000000 },
      { investor_name: 'Fund B', is_new_position: true, is_sold_out: false, shares_change_pct: 80, market_value: 150000000 },
      { investor_name: 'Fund C', is_new_position: false, is_sold_out: true, shares_change_pct: 0, market_value: 1000 },
    ]);

    expect(result.component).toBe(25);
    expect(result.institutional_new_positions).toBe(2);
    expect(result.institutional_closed_positions).toBe(1);
  });

  test('activist component scores 13D over 13G and additional filers', () => {
    const result = calculateActivistComponent([
      { cik: '1', reporting_person: 'Filer 1', form_type: 'SC 13D', filing_date: '2026-05-01' },
      { cik: '2', reporting_person: 'Filer 2', form_type: 'SC 13G/A', filing_date: '2026-05-02' },
      { cik: '3', reporting_person: 'Filer 3', form_type: 'SC 13G', filing_date: '2026-05-03' },
    ]);

    expect(result.component).toBe(10);
    expect(result.activist_filing_count).toBe(3);
  });

  test('score tier assignment follows thresholds', () => {
    expect(scoreTier(75)).toBe('high');
    expect(scoreTier(45)).toBe('medium');
    expect(scoreTier(10)).toBe('low');
  });
});