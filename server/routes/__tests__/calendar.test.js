jest.mock('../../db/pg', () => ({
  queryWithTimeout: jest.fn(),
}));

jest.mock('../../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../services/watchlistDeriver', () => ({
  getCurrentWatchlistSymbols: jest.fn(),
  getWatchlistCacheUpdatedAt: jest.fn(),
}));

jest.mock('../../services/historicalMoveCalculator', () => ({
  computeAvgHistoricalMoveForSymbols: jest.fn(),
}));

jest.mock('../../services/smartMoneyConcentration', () => ({
  getSmartMoneyConcentration: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const { queryWithTimeout } = require('../../db/pg');
const { getCurrentWatchlistSymbols, getWatchlistCacheUpdatedAt } = require('../../services/watchlistDeriver');
const { computeAvgHistoricalMoveForSymbols } = require('../../services/historicalMoveCalculator');
const { getSmartMoneyConcentration } = require('../../services/smartMoneyConcentration');

const calendarRouter = require('../calendar');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/calendar', calendarRouter);
  app.use('/api/watchlist', calendarRouter);
  return app;
}

function baseEventRow(overrides = {}) {
  return {
    id: 1,
    event_type: 'EARNINGS',
    event_date: '2026-05-05',
    event_time: 'BMO',
    event_datetime: null,
    symbol: 'AAPL',
    related_symbols: [],
    title: 'AAPL earnings',
    description: 'Quarterly results',
    source: 'manual',
    source_id: null,
    source_url: 'https://example.com/aapl',
    importance: 8,
    confidence: 'confirmed',
    metadata: {},
    raw_payload: {},
    ingested_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('calendar routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCurrentWatchlistSymbols.mockResolvedValue(new Set());
    getWatchlistCacheUpdatedAt.mockReturnValue('2026-05-05T10:00:00.000Z');
    computeAvgHistoricalMoveForSymbols.mockResolvedValue(new Map());
    getSmartMoneyConcentration.mockResolvedValue(new Map());
  });

  test('GET /api/calendar/events returns 200 with valid params', async () => {
    queryWithTimeout.mockResolvedValueOnce({ rows: [baseEventRow()] });

    const response = await request(buildApp()).get('/api/calendar/events?from=2026-05-05&to=2026-05-12');

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.events[0]).toMatchObject({
      id: '1',
      symbol: 'AAPL',
      category: 'EARNINGS',
      tier: 2,
      impliedMove: null,
      isWatchlist: false,
    });
  });

  test('GET /api/calendar/events returns 400 for invalid dates', async () => {
    const response = await request(buildApp()).get('/api/calendar/events?from=bad-date');
    expect(response.status).toBe(400);
    expect(queryWithTimeout).not.toHaveBeenCalled();
  });

  test('GET /api/calendar/events returns empty array when no events exist', async () => {
    queryWithTimeout.mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp()).get('/api/calendar/events?from=2026-05-05&to=2026-05-06');

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual([]);
  });

  test('GET /api/calendar/events filters tiers after transform', async () => {
    queryWithTimeout.mockResolvedValueOnce({
      rows: [
        baseEventRow({ id: 1, event_type: 'PDUFA', symbol: 'KBR', importance: 10 }),
        baseEventRow({ id: 2, event_type: 'OTHER', symbol: 'MSFT', importance: 3 }),
      ],
    });

    const response = await request(buildApp()).get('/api/calendar/events?tiers=1');

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].tier).toBe(1);
  });

  test('GET /api/calendar/events filters watchlistOnly using beacon watchlist symbols', async () => {
    getCurrentWatchlistSymbols.mockResolvedValue(new Set(['AAPL']));
    queryWithTimeout.mockResolvedValueOnce({ rows: [baseEventRow()] });

    const response = await request(buildApp()).get('/api/calendar/events?watchlistOnly=true');

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(queryWithTimeout.mock.calls[0][1][2]).toEqual(['AAPL']);
  });

  test('GET /api/calendar/events/:id returns 404 for nonexistent id', async () => {
    queryWithTimeout.mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp()).get('/api/calendar/events/999999');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Event not found');
  });

  test('GET /api/calendar/heatmap returns grouped day data for month', async () => {
    queryWithTimeout.mockResolvedValueOnce({
      rows: [
        { id: 1, event_date: '2026-05-05', importance: 8, event_type: 'EARNINGS', symbol: 'AAPL', metadata: {} },
        { id: 2, event_date: '2026-05-06', importance: 5, event_type: 'OTHER', symbol: 'MSFT', metadata: {} },
      ],
    });

    const response = await request(buildApp()).get('/api/calendar/heatmap?month=2026-05');

    expect(response.status).toBe(200);
    expect(response.body.month).toBe('2026-05');
    expect(response.body.days).toHaveLength(2);
  });

  test('GET /api/calendar/today splits BMO intraday AMC and other buckets', async () => {
    queryWithTimeout.mockResolvedValueOnce({
      rows: [
        baseEventRow({ id: 1, symbol: 'AAPL', event_time: 'BMO' }),
        baseEventRow({ id: 2, symbol: 'MSFT', event_time: '14:30' }),
        baseEventRow({ id: 3, symbol: 'NVDA', event_time: 'AMC' }),
        baseEventRow({ id: 4, symbol: null, event_time: null, event_type: 'FOMC' }),
      ],
    });

    const response = await request(buildApp()).get('/api/calendar/today');

    expect(response.status).toBe(200);
    expect(response.body.bmo).toHaveLength(1);
    expect(response.body.intraday).toHaveLength(1);
    expect(response.body.amc).toHaveLength(1);
    expect(response.body.other).toHaveLength(1);
  });
});