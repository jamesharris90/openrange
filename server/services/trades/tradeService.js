const logger = require('../../logger');
const tradeModel = require('./tradeModel');
const ibkrAdapter = require('./ibkrAdapter');
const saxoAdapter = require('./saxoAdapter');

const adapters = { ibkr: ibkrAdapter, saxo: saxoAdapter };

async function importExecutions(userId, brokerType, dateRange) {
  const adapter = adapters[brokerType];
  if (!adapter) throw new Error(`Unsupported broker: ${brokerType}`);

  const userModel = require('../../users/model');
  const connection = await userModel.getBrokerConnection(userId);
  if (!connection) throw new Error('No broker connected');

  const rawExecs = await adapter.fetchExecutions(connection, dateRange);
  const inserted = [];

  for (const raw of rawExecs) {
    const normalised = adapter.normalise(raw);
    adapter.validate(normalised);
    const row = await tradeModel.insertExecution({
      userId,
      datasetScope: 'user',
      broker: brokerType,
      symbol: normalised.symbol,
      side: normalised.side,
      qty: normalised.qty,
      price: normalised.price,
      commission: normalised.commission,
      execTime: normalised.execTime,
      rawJson: normalised.rawJson,
    });
    inserted.push(row);
  }

  logger.info(`Imported ${inserted.length} executions for user ${userId} from ${brokerType}`);
  return { imported: inserted.length };
}

async function logManualTrade(userId, data) {
  const { symbol, side, entryPrice, exitPrice, qty, commission, openedAt, closedAt, setupType, conviction, notes } = data;

  const pnlDollar = exitPrice != null
    ? +(((side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice) * qty) - (commission || 0)).toFixed(2)
    : null;
  const pnlPercent = exitPrice != null && entryPrice > 0
    ? +(((side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice) / entryPrice) * 100).toFixed(4)
    : null;
  const durationSeconds = closedAt && openedAt
    ? Math.round((new Date(closedAt) - new Date(openedAt)) / 1000)
    : null;
  const status = exitPrice != null ? 'closed' : 'open';

  const tradeRow = await tradeModel.insertTrade({
    userId,
    datasetScope: 'user',
    symbol: symbol.toUpperCase(),
    side,
    entryPrice,
    exitPrice: exitPrice || null,
    qty,
    pnlDollar,
    pnlPercent,
    commissionTotal: commission || 0,
    openedAt: openedAt || new Date().toISOString(),
    closedAt: closedAt || null,
    durationSeconds,
    status,
  });

  if (setupType || conviction || notes) {
    await tradeModel.upsertMetadata(tradeRow.trade_id, { setupType, conviction, notes });
  }

  return tradeRow;
}

async function getTradesForUser(userId, scope, filters) {
  return tradeModel.getTrades(userId, scope, filters);
}

async function getTradeDetail(tradeId, userId) {
  return tradeModel.getTradeById(tradeId, userId);
}

async function getSummary(userId, scope, dateRange) {
  return tradeModel.getTradeSummary(userId, scope, dateRange);
}

module.exports = {
  importExecutions,
  logManualTrade,
  getTradesForUser,
  getTradeDetail,
  getSummary,
};
