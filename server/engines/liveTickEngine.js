const WebSocket = require('ws');

const WS_URL = 'wss://financialmodelingprep.com/ws/us-stocks';
const RECONNECT_MS = 5000;
const TICK_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_BUFFER_SIZE = 10000;
const SUBSCRIBE_BATCH_SIZE = 400;

let socket = null;
let reconnectTimer = null;
let subscribedSymbols = [];
let latestTicks = Object.create(null);
let cleanupTimer = null;
let tickCounter = 0;

function normalizeSymbols(symbols = []) {
  return Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function scheduleCleanup() {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const symbols = Object.keys(latestTicks);

    for (const symbol of symbols) {
      const tick = latestTicks[symbol];
      if (!tick || now - Number(tick.timestamp || 0) > TICK_TTL_MS) {
        delete latestTicks[symbol];
      }
    }

    if (symbols.length > MAX_BUFFER_SIZE) {
      const staleFirst = Object.entries(latestTicks)
        .sort((a, b) => Number(a[1]?.timestamp || 0) - Number(b[1]?.timestamp || 0))
        .slice(0, symbols.length - MAX_BUFFER_SIZE);

      for (const [symbol] of staleFirst) {
        delete latestTicks[symbol];
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function sendJson(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function subscribe(symbols) {
  const normalized = normalizeSymbols(symbols);
  if (!normalized.length) {
    console.warn('[WS] No symbols provided for subscription');
    return;
  }

  subscribedSymbols = normalized;

  for (let i = 0; i < normalized.length; i += SUBSCRIBE_BATCH_SIZE) {
    const batch = normalized.slice(i, i + SUBSCRIBE_BATCH_SIZE);
    sendJson({
      event: 'subscribe',
      data: { ticker: batch.join(',') },
    });
  }

  console.log(`[WS] Subscribed symbols: ${normalized.length}`);
}

function handleTick(rawTick) {
  if (!rawTick || typeof rawTick !== 'object') return;

  const symbol = String(rawTick.s || '').trim().toUpperCase();
  if (!symbol) return;

  const price = Number(rawTick.ap ?? rawTick.bp ?? rawTick.p);
  const volume = Number(rawTick.v);

  if (!Number.isFinite(price) || !Number.isFinite(volume)) return;

  latestTicks[symbol] = {
    price,
    volume,
    timestamp: Date.now(),
  };

  tickCounter += 1;
  if (tickCounter === 1 || tickCounter % 500 === 0) {
    console.log('[WS] Receiving ticks', { count: tickCounter, buffer_size: Object.keys(latestTicks).length });
  }
}

function handleMessage(message) {
  let payload;
  try {
    payload = JSON.parse(String(message));
  } catch (err) {
    console.error('[WS PARSE ERROR]', err.message);
    return;
  }

  if (Array.isArray(payload)) {
    for (const tick of payload) {
      handleTick(tick);
    }
    return;
  }

  handleTick(payload);
}

function connect() {
  const apiKey = String(process.env.FMP_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[WS] FMP_API_KEY missing; live tick engine not started');
    return;
  }

  clearReconnectTimer();
  socket = new WebSocket(WS_URL);

  socket.on('open', () => {
    console.log('[WS] Connected to FMP');
    sendJson({
      event: 'login',
      data: { apiKey },
    });

    subscribe(subscribedSymbols);
  });

  socket.on('message', handleMessage);

  socket.on('close', () => {
    console.warn(`[WS] Disconnected. Reconnecting in ${Math.floor(RECONNECT_MS / 1000)}s...`);
    socket = null;

    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      connect();
    }, RECONNECT_MS);
  });

  socket.on('error', (err) => {
    console.error('[WS ERROR]', err.message);
  });
}

function startLiveTickEngine(symbols = []) {
  subscribedSymbols = normalizeSymbols(symbols);

  scheduleCleanup();

  if (socket) {
    if (socket.readyState === WebSocket.OPEN) {
      subscribe(subscribedSymbols);
    }
    return;
  }

  connect();
}

function getLatestTick(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  if (!key) return null;

  return latestTicks[key] || null;
}

module.exports = {
  startLiveTickEngine,
  getLatestTick,
};
