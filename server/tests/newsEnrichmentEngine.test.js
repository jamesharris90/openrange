jest.mock('../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

const { detectCluster } = require('../services/newsEnrichmentEngine');

describe('news enrichment cluster detection', () => {
  test('kbr contract headlines classify as contract award', () => {
    expect(detectCluster(
      'KBR Awarded $449 Million Army LOGCAP Extension',
      'Contract to provide joint data and analytic support services.'
    )).toBe('CONTRACT_AWARD');
  });

  test('phase 3 success headlines classify as trial success', () => {
    expect(detectCluster(
      'Rigel Pharmaceuticals Announces Phase 3 Success in REZLIDHIA Trial',
      'The primary endpoint was met with topline positive data.'
    )).toBe('TRIAL_SUCCESS');
  });

  test('fda approval headlines classify as fda approval', () => {
    expect(detectCluster('FDA Approves XYZ Drug for Treatment of Rare Disease', '')).toBe('FDA_APPROVAL');
  });

  test('fda complete response letter does not classify as fda approval', () => {
    expect(detectCluster('Company XYZ Receives FDA Complete Response Letter', '')).not.toBe('FDA_APPROVAL');
  });

  test('guidance raise headlines classify as guidance raise', () => {
    expect(detectCluster('Company Raises Full-Year Guidance After Strong Q1', '')).toBe('GUIDANCE_RAISE');
  });

  test('partnership headlines classify as partnership', () => {
    expect(detectCluster('Acme Inc Announces Strategic Partnership with Beta Corp', '')).toBe('PARTNERSHIP');
  });

  test('spinoff headlines classify as spinoff', () => {
    expect(detectCluster('Fortrea Begins Trading After Spinoff from Labcorp', '')).toBe('SPINOFF');
  });

  test('mission critical technology does not classify as earnings', () => {
    expect(detectCluster('Mission Critical Technology Selected for Platform Upgrade', '')).not.toBe('EARNINGS');
  });

  test('beating heart technology does not classify as earnings', () => {
    expect(detectCluster('Beating Heart Technology Wins Innovation Showcase', '')).not.toBe('EARNINGS');
  });

  test('phase 3 failure does not classify as trial success', () => {
    expect(detectCluster('Phase 3 Trial Failure Sends Shares Lower', '')).not.toBe('TRIAL_SUCCESS');
  });

  test('earnings headlines still classify as earnings', () => {
    expect(detectCluster('Company beats earnings expectations and raises quarterly revenue guidance', '')).toBe('EARNINGS');
  });

  test('explicit merger headlines still classify as merger', () => {
    expect(detectCluster('Company announces merger deal with strategic buyer', '')).toBe('MERGER');
  });
});