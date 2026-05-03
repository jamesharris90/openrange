'use strict';

const cal = require('../tradingCalendar');

describe('tradingCalendar.isInSession', () => {
  test('Tuesday 14:00 UTC is in session', () => {
    expect(cal.isInSession(new Date('2026-05-19T14:00:00Z'))).toBe(true);
  });

  test('Tuesday 22:00 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-05-19T22:00:00Z'))).toBe(false);
  });

  test('Saturday 14:00 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-05-23T14:00:00Z'))).toBe(false);
  });

  test('Memorial Day 2026 14:00 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-05-25T14:00:00Z'))).toBe(false);
  });

  test('Juneteenth 2026 14:00 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-06-19T14:00:00Z'))).toBe(false);
  });

  test('July 3 2026 14:00 UTC is not in session because it is the observed Independence Day close', () => {
    expect(cal.isInSession(new Date('2026-07-03T14:00:00Z'))).toBe(false);
  });

  test('Day after Thanksgiving 2026 15:00 UTC is in session', () => {
    expect(cal.isInSession(new Date('2026-11-27T15:00:00Z'))).toBe(true);
  });

  test('Day after Thanksgiving 2026 18:30 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-11-27T18:30:00Z'))).toBe(false);
  });

  test('Christmas Eve 2026 15:00 UTC is in session', () => {
    expect(cal.isInSession(new Date('2026-12-24T15:00:00Z'))).toBe(true);
  });

  test('Christmas Eve 2026 18:30 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-12-24T18:30:00Z'))).toBe(false);
  });

  test('Christmas Day 2026 14:00 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2026-12-25T14:00:00Z'))).toBe(false);
  });

  test('New Years Day 2027 14:30 UTC is not in session', () => {
    expect(cal.isInSession(new Date('2027-01-01T14:30:00Z'))).toBe(false);
  });
});

describe('tradingCalendar.nextSession', () => {
  test('Tuesday 22:00 UTC resolves to Wednesday standard session', () => {
    const result = cal.nextSession(new Date('2026-05-19T22:00:00Z'));
    expect(result.open.toISOString()).toBe('2026-05-20T13:30:00.000Z');
    expect(result.close.toISOString()).toBe('2026-05-20T20:00:00.000Z');
    expect(result.sessionMinutes).toBe(390);
    expect(result.isEarlyClose).toBe(false);
  });

  test('Friday before Memorial Day weekend resolves to Tuesday', () => {
    const result = cal.nextSession(new Date('2026-05-22T22:00:00Z'));
    expect(result.open.toISOString()).toBe('2026-05-26T13:30:00.000Z');
  });

  test('Wednesday before Thanksgiving resolves to Friday early-close session', () => {
    const result = cal.nextSession(new Date('2026-11-25T22:00:00Z'));
    expect(result.open.toISOString()).toBe('2026-11-27T14:30:00.000Z');
    expect(result.close.toISOString()).toBe('2026-11-27T18:00:00.000Z');
    expect(result.sessionMinutes).toBe(210);
    expect(result.isEarlyClose).toBe(true);
  });

  test('December 31 2026 17:30 UTC resolves to January 4 2027 standard winter session', () => {
    const result = cal.nextSession(new Date('2026-12-31T17:30:00Z'));
    expect(result.open.toISOString()).toBe('2027-01-04T14:30:00.000Z');
    expect(result.close.toISOString()).toBe('2027-01-04T21:00:00.000Z');
  });

  test('Wednesday July 1 2026 22:00 UTC resolves to Thursday July 2', () => {
    const result = cal.nextSession(new Date('2026-07-01T22:00:00Z'));
    expect(result.open.toISOString()).toBe('2026-07-02T13:30:00.000Z');
  });

  test('Thursday July 2 2026 22:00 UTC skips observed Friday holiday and resolves to Monday July 6', () => {
    const result = cal.nextSession(new Date('2026-07-02T22:00:00Z'));
    expect(result.open.toISOString()).toBe('2026-07-06T13:30:00.000Z');
  });
});

describe('tradingCalendar.currentSession', () => {
  test('Tuesday 14:00 UTC returns Tuesday session', () => {
    const result = cal.currentSession(new Date('2026-05-19T14:00:00Z'));
    expect(result).not.toBeNull();
    expect(result.close.toISOString()).toBe('2026-05-19T20:00:00.000Z');
  });

  test('Tuesday 22:00 UTC returns null', () => {
    expect(cal.currentSession(new Date('2026-05-19T22:00:00Z'))).toBeNull();
  });

  test('Saturday returns null', () => {
    expect(cal.currentSession(new Date('2026-05-23T14:00:00Z'))).toBeNull();
  });

  test('Christmas Eve 2026 15:00 UTC returns early-close session', () => {
    const result = cal.currentSession(new Date('2026-12-24T15:00:00Z'));
    expect(result).not.toBeNull();
    expect(result.isEarlyClose).toBe(true);
    expect(result.sessionMinutes).toBe(210);
  });
});

describe('tradingCalendar.sessionAfter', () => {
  test('Friday session resolves to Monday session when there is no holiday', () => {
    const friday = cal.currentSession(new Date('2026-05-15T14:00:00Z'));
    const next = cal.sessionAfter(friday);
    expect(next.open.toISOString()).toBe('2026-05-18T13:30:00.000Z');
  });

  test('Friday before Memorial Day resolves to Tuesday', () => {
    const friday = cal.currentSession(new Date('2026-05-22T14:00:00Z'));
    const next = cal.sessionAfter(friday);
    expect(next.open.toISOString()).toBe('2026-05-26T13:30:00.000Z');
  });

  test('Wednesday before Thanksgiving resolves to Friday early-close session', () => {
    const wednesday = cal.currentSession(new Date('2026-11-25T15:00:00Z'));
    const next = cal.sessionAfter(wednesday);
    expect(next.isEarlyClose).toBe(true);
    expect(next.close.toISOString()).toBe('2026-11-27T18:00:00.000Z');
  });
});