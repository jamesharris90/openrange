'use strict';

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env'),
  override: false,
});

const { computeStatus } = require('../captureOutcome');

describe('captureOutcome.computeStatus', () => {
  test('All 4 captures = complete', () => {
    const pick = {
      outcome_status: 'pending',
      outcome_t1_captured_at: null,
      outcome_t2_captured_at: null,
      outcome_t3_captured_at: null,
      outcome_t4_captured_at: null,
    };
    const updates = {
      outcome_t1_captured_at: new Date(),
      outcome_t2_captured_at: new Date(),
      outcome_t3_captured_at: new Date(),
      outcome_t4_captured_at: new Date(),
    };
    expect(computeStatus(pick, updates)).toBe('complete');
  });

  test('1 of 4 captured = partial', () => {
    const pick = {
      outcome_status: 'pending',
      outcome_t1_captured_at: null,
      outcome_t2_captured_at: null,
      outcome_t3_captured_at: null,
      outcome_t4_captured_at: null,
    };
    const updates = { outcome_t1_captured_at: new Date() };
    expect(computeStatus(pick, updates)).toBe('partial');
  });

  test('Existing partial + new capture stays partial until 4', () => {
    const pick = {
      outcome_status: 'partial',
      outcome_t1_captured_at: new Date(),
      outcome_t2_captured_at: null,
      outcome_t3_captured_at: null,
      outcome_t4_captured_at: null,
    };
    const updates = { outcome_t2_captured_at: new Date() };
    expect(computeStatus(pick, updates)).toBe('partial');
  });

  test('Existing 3 + final capture = complete', () => {
    const pick = {
      outcome_status: 'partial',
      outcome_t1_captured_at: new Date(),
      outcome_t2_captured_at: new Date(),
      outcome_t3_captured_at: new Date(),
      outcome_t4_captured_at: null,
    };
    const updates = { outcome_t4_captured_at: new Date() };
    expect(computeStatus(pick, updates)).toBe('complete');
  });

  test('No captures = pending stays pending', () => {
    const pick = {
      outcome_status: 'pending',
      outcome_t1_captured_at: null,
      outcome_t2_captured_at: null,
      outcome_t3_captured_at: null,
      outcome_t4_captured_at: null,
    };
    const updates = { outcome_last_attempted_at: new Date() };
    expect(computeStatus(pick, updates)).toBe('pending');
  });

  test('Stale with no new captures stays stale', () => {
    const pick = {
      outcome_status: 'stale',
      outcome_t1_captured_at: null,
      outcome_t2_captured_at: null,
      outcome_t3_captured_at: null,
      outcome_t4_captured_at: null,
    };
    const updates = { outcome_last_attempted_at: new Date() };
    expect(computeStatus(pick, updates)).toBe('stale');
  });
});