'use strict';

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env'),
  override: false,
});

const { runHealthSweep, STALE_THRESHOLDS_HOURS, STALE_TO_ERRORED_DAYS } = require('../healthSweep');

describe('healthSweep module', () => {
  test('module exports runHealthSweep function', () => {
    expect(typeof runHealthSweep).toBe('function');
  });

  test('stale thresholds match spec', () => {
    expect(STALE_THRESHOLDS_HOURS).toEqual({ 1: 6, 2: 12, 3: 24, 4: 48 });
    expect(STALE_TO_ERRORED_DAYS).toBe(7);
  });
});