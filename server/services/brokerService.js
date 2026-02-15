const logger = require('../logger');
const userModel = require('../users/model');
const ibkrProvider = require('../providers/brokers/ibkrProvider');
const saxoProvider = require('../providers/brokers/saxoProvider');

const providers = {
  ibkr: ibkrProvider,
  saxo: saxoProvider
};

const brokerHealth = new Map(); // userId -> { lastResponseMs, lastError, lastErrorAt, failures: [timestamps] }

function recordHealth(userId, { durationMs = null, error = null, brokerType }) {
  const entry = brokerHealth.get(userId) || { failures: [] };
  if (durationMs != null) entry.lastResponseMs = durationMs;
  if (error) {
    entry.lastError = error;
    entry.lastErrorAt = Date.now();
    entry.failures = [...entry.failures.filter(ts => Date.now() - ts < 24 * 3600 * 1000), Date.now()];
  }
  entry.brokerType = brokerType;
  brokerHealth.set(userId, entry);
}

function getHealth(userId) {
  const entry = brokerHealth.get(userId) || { failures: [] };
  const failures24h = (entry.failures || []).filter(ts => Date.now() - ts < 24 * 3600 * 1000).length;
  return {
    brokerType: entry.brokerType || null,
    lastResponseMs: entry.lastResponseMs || null,
    lastError: entry.lastError || null,
    lastErrorAt: entry.lastErrorAt || null,
    failedCalls24h: failures24h,
    status: failures24h >= 3 ? 'red' : failures24h > 0 ? 'yellow' : 'green'
  };
}

async function connectBroker(userId, brokerType, { accessToken, refreshToken, username, password } = {}) {
  if (!providers[brokerType]) {
    throw new Error('Unsupported broker');
  }
  let tokens = { accessToken: accessToken || null, refreshToken: refreshToken || null };

  // If credentials provided and provider supports login, exchange for tokens
  if ((username || password) && typeof providers[brokerType].login === 'function') {
    tokens = await providers[brokerType].login({ username, password });
  }

  await userModel.saveBrokerConnection(userId, brokerType, tokens.accessToken || null, tokens.refreshToken || null, 'connected');
  recordHealth(userId, { durationMs: null, error: null, brokerType });
  return getBrokerStatus(userId);
}

async function disconnectBroker(userId) {
  await userModel.clearBrokerConnection(userId);
  brokerHealth.delete(userId);
  return { connected: false, broker: null, status: 'disconnected' };
}

async function getBrokerStatus(userId) {
  const connection = await userModel.getBrokerConnection(userId);
  if (!connection || !connection.brokerType) {
    return { connected: false, broker: null, provider: null, status: 'disconnected', connectedAt: null };
  }
  return {
    connected: connection.status === 'connected',
    broker: connection.brokerType,
    provider: connection.brokerType,
    status: connection.status || 'connected',
    connectedAt: connection.connectedAt
  };
}

function getProvider(connection) {
  if (!connection?.brokerType) return null;
  return providers[connection.brokerType] || null;
}

async function getAccountSnapshot(userId) {
  const connection = await userModel.getBrokerConnection(userId);
  if (!connection || !connection.brokerType) {
    throw new Error('No broker connected');
  }
  const provider = getProvider(connection);
  if (!provider) throw new Error('Unsupported broker');
  const start = Date.now();
  try {
    const data = await provider.getAccountSummary(connection);
    const duration = Date.now() - start;
    recordHealth(userId, { durationMs: duration, error: null, brokerType: connection.brokerType });
    return data;
  } catch (err) {
    recordHealth(userId, { durationMs: null, error: err.message, brokerType: connection.brokerType });
    await userModel.updateBrokerStatus(userId, 'expired');
    throw err;
  }
}

async function getOpenPositions(userId) {
  const connection = await userModel.getBrokerConnection(userId);
  if (!connection || !connection.brokerType) {
    throw new Error('No broker connected');
  }
  const provider = getProvider(connection);
  if (!provider) throw new Error('Unsupported broker');
  const start = Date.now();
  try {
    const data = await provider.getPositions(connection);
    const duration = Date.now() - start;
    recordHealth(userId, { durationMs: duration, error: null, brokerType: connection.brokerType });
    return data;
  } catch (err) {
    recordHealth(userId, { durationMs: null, error: err.message, brokerType: connection.brokerType });
    await userModel.updateBrokerStatus(userId, 'expired');
    throw err;
  }
}

async function getDailyPnL(userId) {
  const connection = await userModel.getBrokerConnection(userId);
  if (!connection || !connection.brokerType) {
    throw new Error('No broker connected');
  }
  const provider = getProvider(connection);
  if (!provider) throw new Error('Unsupported broker');
  const start = Date.now();
  try {
    const data = await provider.getDailyPnL(connection);
    const duration = Date.now() - start;
    recordHealth(userId, { durationMs: duration, error: null, brokerType: connection.brokerType });
    return data;
  } catch (err) {
    recordHealth(userId, { durationMs: null, error: err.message, brokerType: connection.brokerType });
    await userModel.updateBrokerStatus(userId, 'expired');
    throw err;
  }
}

async function getWeeklyPerformance(userId) {
  const connection = await userModel.getBrokerConnection(userId);
  if (!connection || !connection.brokerType) {
    throw new Error('No broker connected');
  }
  const provider = getProvider(connection);
  if (!provider) throw new Error('Unsupported broker');
  const start = Date.now();
  try {
    const equityCurve = await provider.getHistoricalEquity(7, connection);
    const duration = Date.now() - start;
    recordHealth(userId, { durationMs: duration, error: null, brokerType: connection.brokerType });
    return equityCurve;
  } catch (err) {
    recordHealth(userId, { durationMs: null, error: err.message, brokerType: connection.brokerType });
    await userModel.updateBrokerStatus(userId, 'expired');
    throw err;
  }
}

async function getHealthSummary(userId) {
  return getHealth(userId);
}

async function revokeBroker(userId) {
  return disconnectBroker(userId);
}

module.exports = {
  connectBroker,
  disconnectBroker,
  getBrokerStatus,
  getAccountSnapshot,
  getOpenPositions,
  getDailyPnL,
  getWeeklyPerformance,
  getHealthSummary,
  revokeBroker
};
