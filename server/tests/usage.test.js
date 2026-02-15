const fs = require('fs');
const path = require('path');

describe('Usage persistence', () => {
  const dbFile = path.join(__dirname, 'tmp-usage.db');

  beforeEach(() => {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    process.env.DB_PATH = dbFile;
    jest.resetModules();
  });

  afterEach(() => {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  });

  test('records and aggregates usage events', async () => {
    const db = require('../db');
    await db.recordUsage({ user: 'alice', path: '/api/foo', ts: Date.now() });
    await db.recordUsage({ user: 'bob', path: '/api/foo', ts: Date.now() });
    await db.recordUsage({ user: 'alice', path: '/api/bar', ts: Date.now() });

    const usage = await db.getUsage({ minutes: 5, limit: 5 });
    expect(usage.total).toBe(3);
    const alice = usage.perUser.find(u => u.user === 'alice');
    const bob = usage.perUser.find(u => u.user === 'bob');
    expect(alice.c).toBe(2);
    expect(bob.c).toBe(1);
    const fooPath = usage.perPath.find(p => p.path === '/api/foo');
    expect(fooPath.c).toBe(2);
  });
});
