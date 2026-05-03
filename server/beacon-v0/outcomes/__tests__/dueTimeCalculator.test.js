'use strict';

const { computeDueTimes } = require('../dueTimeCalculator');

describe('dueTimeCalculator', () => {
  test('Example 1: nightly pick Friday 22:00 UTC', () => {
    const result = computeDueTimes(new Date('2026-05-15T22:00:00Z'), 'nightly');
    expect(result.t1_due_at.toISOString()).toBe('2026-05-18T14:30:00.000Z');
    expect(result.t2_due_at.toISOString()).toBe('2026-05-18T20:00:00.000Z');
    expect(result.t3_due_at.toISOString()).toBe('2026-05-19T13:30:00.000Z');
    expect(result.t4_due_at.toISOString()).toBe('2026-05-19T20:00:00.000Z');
    expect(result.t1_session_minutes).toBe(390);
    expect(result.t4_session_minutes).toBe(390);
  });

  test('Example 2: premarket pick Monday 12:00 UTC', () => {
    const result = computeDueTimes(new Date('2026-05-18T12:00:00Z'), 'premarket');
    expect(result.t1_due_at.toISOString()).toBe('2026-05-18T14:30:00.000Z');
    expect(result.t2_due_at.toISOString()).toBe('2026-05-18T20:00:00.000Z');
    expect(result.t3_due_at.toISOString()).toBe('2026-05-19T13:30:00.000Z');
    expect(result.t4_due_at.toISOString()).toBe('2026-05-19T20:00:00.000Z');
  });

  test('Example 3: open pick Monday 13:45 UTC', () => {
    const result = computeDueTimes(new Date('2026-05-18T13:45:00Z'), 'open');
    expect(result.t1_due_at.toISOString()).toBe('2026-05-18T14:45:00.000Z');
    expect(result.t2_due_at.toISOString()).toBe('2026-05-18T20:00:00.000Z');
  });

  test('Example 4: power_hour pick Monday 18:00 UTC', () => {
    const result = computeDueTimes(new Date('2026-05-18T18:00:00Z'), 'power_hour');
    expect(result.t1_due_at.toISOString()).toBe('2026-05-18T19:00:00.000Z');
    expect(result.t2_due_at.toISOString()).toBe('2026-05-18T20:00:00.000Z');
  });

  test('Friday nightly before Memorial Day skips Monday holiday', () => {
    const result = computeDueTimes(new Date('2026-05-22T22:00:00Z'), 'nightly');
    expect(result.t1_due_at.toISOString()).toBe('2026-05-26T14:30:00.000Z');
    expect(result.t2_due_at.toISOString()).toBe('2026-05-26T20:00:00.000Z');
    expect(result.t3_due_at.toISOString()).toBe('2026-05-27T13:30:00.000Z');
  });

  test('Wednesday before Thanksgiving nightly lands on Friday early close for T1 and T2', () => {
    const result = computeDueTimes(new Date('2026-11-25T22:00:00Z'), 'nightly');
    expect(result.t1_due_at.toISOString()).toBe('2026-11-27T15:30:00.000Z');
    expect(result.t2_due_at.toISOString()).toBe('2026-11-27T18:00:00.000Z');
    expect(result.t1_session_minutes).toBe(210);
    expect(result.t2_session_minutes).toBe(210);
    expect(result.t3_session_minutes).toBe(390);
    expect(result.t4_session_minutes).toBe(390);
  });

  test('Edge: open pick at 19:30 UTC caps T1 at session close', () => {
    const result = computeDueTimes(new Date('2026-05-18T19:30:00Z'), 'open');
    expect(result.t1_due_at.toISOString()).toBe('2026-05-18T20:00:00.000Z');
  });

  test('Edge: power_hour pick at 17:30 UTC on early-close Friday caps T1', () => {
    const result = computeDueTimes(new Date('2026-11-27T17:30:00Z'), 'power_hour');
    expect(result.t1_due_at.toISOString()).toBe('2026-11-27T18:00:00.000Z');
    expect(result.t1_session_minutes).toBe(210);
  });

  test('Friday nightly before observed Independence Day weekend 2026 resolves to Monday July 6', () => {
    const result = computeDueTimes(new Date('2026-07-02T22:00:00Z'), 'nightly');
    expect(result.t1_due_at.toISOString()).toBe('2026-07-06T14:30:00.000Z');
  });
});