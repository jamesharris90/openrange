jest.mock('../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

const { detectCluster } = require('../services/newsEnrichmentEngine');

describe('news enrichment cluster detection', () => {
  test('mission contract headlines do not classify as earnings', () => {
    const cluster = detectCluster(
      'KBR Mission Technology Solutions Awarded $449 Million Army LOGCAP Extension in Europe and North America',
      'Contract to provide joint data and analytic support services.'
    );

    expect(cluster).not.toBe('EARNINGS');
  });

  test('earnings headlines still classify as earnings', () => {
    expect(detectCluster('Company beats earnings expectations and raises guidance', '')).toBe('EARNINGS');
  });

  test('substring matches do not trigger merger classification', () => {
    expect(detectCluster('Combined systems update for mission operations', '')).toBeNull();
  });

  test('explicit merger headlines still classify as merger', () => {
    expect(detectCluster('Company announces merger deal with strategic buyer', '')).toBe('MERGER');
  });
});