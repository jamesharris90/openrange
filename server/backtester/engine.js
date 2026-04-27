const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { loadStrategyModules } = require('./strategyLoader');
const { calculateStrategyScores } = require('./scorer');
const { toDateKey, upsertRows, buildFundamentals, sortBars, toNumber } = require('./utils');

const RESULT_TABLE = 'strategy_backtest_signals';
const DEFAULT_PAGE_SIZE = Number(process.env.BACKTESTER_PAGE_SIZE || 500);
const PROGRESS_EVERY_SYMBOLS = Number(process.env.BACKTESTER_PROGRESS_EVERY || 100);
const GC_EVERY_SYMBOLS = Number(process.env.BACKTESTER_GC_EVERY || 200);
const BACKTEST_HEARTBEAT_SYMBOLS = 25;
const BACKTEST_HEARTBEAT_MS = 60 * 1000;
const DEFAULT_CHECKPOINT_DIR = path.join(__dirname, '..', 'logs', 'backtests', 'checkpoints');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeFileIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function buildCheckpointScope({ mode, strategyIds, symbols }) {
  const normalized = {
    mode: mode || 'historical',
    strategyIds: Array.isArray(strategyIds) && strategyIds.length
      ? [...strategyIds].map((value) => String(value).trim()).filter(Boolean).sort()
      : ['ALL'],
    symbols: Array.isArray(symbols) && symbols.length
      ? [...symbols].map((value) => String(value).trim().toUpperCase()).filter(Boolean).sort()
      : ['ALL'],
  };
  const serialized = JSON.stringify(normalized);
  return {
    key: crypto.createHash('sha1').update(serialized).digest('hex').slice(0, 12),
    serialized,
    normalized,
  };
}

function resolveCheckpointFile(options) {
  if (options.checkpointFile) {
    return options.checkpointFile;
  }

  const scope = buildCheckpointScope(options);
  ensureDirectory(DEFAULT_CHECKPOINT_DIR);
  return path.join(DEFAULT_CHECKPOINT_DIR, `phase2-backfill-${scope.key}.json`);
}

function readCheckpoint(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.name === 'SyntaxError')) {
      return null;
    }
    throw error;
  }
}

function writeCheckpoint(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

async function maybeAwait(value) {
  return value;
}

async function fetchUniverseMetadata() {
  const result = await queryWithTimeout(
    `SELECT symbol, company_name, exchange, sector, industry, market_cap, is_active
     FROM ticker_universe
     WHERE is_active = true
     ORDER BY symbol`,
    [],
    { timeoutMs: 30000, label: 'backtester.engine.ticker_universe', maxRetries: 0, slowQueryMs: 1500 }
  );

  const map = new Map();
  for (const row of result.rows || []) {
    map.set(row.symbol, row);
  }
  return map;
}

async function fetchNewsForSymbol(symbol) {
  const result = await queryWithTimeout(
    `SELECT symbol, published_at, headline, source
     FROM news_articles
     WHERE symbol = $1
     ORDER BY published_at ASC`,
    [symbol],
    { timeoutMs: 12000, label: `backtester.engine.news.${symbol}`, maxRetries: 0, slowQueryMs: 800 }
  );
  return result.rows || [];
}

async function fetchEarningsForSymbol(symbol) {
  const result = await queryWithTimeout(
    `SELECT symbol, report_date, report_time, eps_actual, eps_estimate, expected_move_percent, actual_move_percent
     FROM earnings_history
     WHERE symbol = $1
     ORDER BY report_date ASC`,
    [symbol],
    { timeoutMs: 12000, label: `backtester.engine.earnings.${symbol}`, maxRetries: 0, slowQueryMs: 800 }
  );
  return result.rows || [];
}

async function fetchLatestMarketRegime() {
  const result = await queryWithTimeout(
    `SELECT trend, volatility, liquidity, session_type, vix_price, spy_price, market_volume_ratio, created_at
     FROM market_regime
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
    { timeoutMs: 10000, label: 'backtester.engine.market_regime', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));
  return result.rows?.[0] || {
    trend: 'RANGE',
    volatility: 'NORMAL',
    liquidity: 'LOW',
    session_type: 'AFTERHOURS',
    vix_price: null,
    spy_price: null,
    market_volume_ratio: null,
  };
}

async function fetchLatestDates() {
  const [dailyResult, intradayResult] = await Promise.all([
    queryWithTimeout(`SELECT MAX(date) AS latest_date FROM daily_ohlcv`, [], { timeoutMs: 12000, label: 'backtester.engine.latest_daily', maxRetries: 0 }),
    queryWithTimeout(`SELECT MAX(timestamp)::date AS latest_date FROM intraday_1m`, [], { timeoutMs: 12000, label: 'backtester.engine.latest_intraday', maxRetries: 0 }),
  ]);

  return {
    latestDailyDate: toDateKey(dailyResult.rows?.[0]?.latest_date),
    latestIntradayDate: toDateKey(intradayResult.rows?.[0]?.latest_date),
  };
}

async function fetchBarsPaged({ table, symbol, columns, orderColumn, pageSize = DEFAULT_PAGE_SIZE, labelPrefix }) {
  const rows = [];
  let offset = 0;

  for (;;) {
    const result = await queryWithTimeout(
      `SELECT ${columns.join(', ')}
       FROM ${table}
       WHERE symbol = $1
       ORDER BY ${orderColumn} ASC
       LIMIT $2 OFFSET $3`,
      [symbol, pageSize, offset],
      {
        timeoutMs: 15000,
        label: `${labelPrefix}.${symbol}.${offset}`,
        maxRetries: 0,
        slowQueryMs: 800,
      }
    );

    const batch = result.rows || [];
    if (!batch.length) break;

    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return rows;
}

async function fetchDailyBars(symbol) {
  return fetchBarsPaged({
    table: 'daily_ohlcv',
    symbol,
    columns: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'],
    orderColumn: 'date',
    labelPrefix: 'backtester.engine.daily',
  });
}

async function fetchIntradayBars(symbol) {
  return fetchBarsPaged({
    table: 'intraday_1m',
    symbol,
    columns: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'session'],
    orderColumn: 'timestamp',
    labelPrefix: 'backtester.engine.intraday',
  });
}

function getHeapUsageMb() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
}

function getHeapUsageMbValue() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function maybeRunGc(processedSymbols) {
  if (processedSymbols === 0 || processedSymbols % GC_EVERY_SYMBOLS !== 0) {
    return;
  }
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

async function buildSharedDataCaches() {
  const [universeMetadata, marketRegime, latestDates] = await Promise.all([
    fetchUniverseMetadata(),
    fetchLatestMarketRegime(),
    fetchLatestDates(),
  ]);
  const universeSymbols = Array.from(universeMetadata.keys()).sort();

  return {
    universeMetadata,
    marketRegime,
    latestDailyDate: latestDates.latestDailyDate,
    latestIntradayDate: latestDates.latestIntradayDate,
    symbolsByDataRequirement() {
      return universeSymbols;
    },
    buildContext(symbol, dataset, extra = {}) {
      const meta = universeMetadata.get(symbol) || { symbol };
      return {
        news: dataset.news || [],
        earnings: dataset.earnings || [],
        marketRegime,
        fundamentals: buildFundamentals(meta, dataset.dailyBars || []),
        symbolMeta: meta,
        dailyBars: dataset.dailyBars || [],
        intradayBars: dataset.intradayBars || [],
        scanRange: extra.scanRange || null,
        projected: extra.projected === true,
      };
    },
    resolveBarsForStrategy(strategy, dataset) {
      if (strategy.dataRequired === 'intraday_1m') return dataset.intradayBars || [];
      if (strategy.dataRequired === 'daily_ohlcv') return dataset.dailyBars || [];
      return strategy.timeframe === 'intraday' ? (dataset.intradayBars || []) : (dataset.dailyBars || []);
    },
    hasDaily(symbol) {
      return universeMetadata.has(symbol);
    },
    hasIntraday(symbol) {
      return universeMetadata.has(symbol);
    },
  };
}

async function loadSymbolDataset(symbol, strategyOrStrategies, sharedData) {
  const strategies = Array.isArray(strategyOrStrategies) ? strategyOrStrategies : [strategyOrStrategies];
  const needsDaily = strategies.some((strategy) => strategy.dataRequired === 'daily_ohlcv' || strategy.dataRequired === 'both' || strategy.timeframe !== 'intraday');
  const needsIntraday = strategies.some((strategy) => strategy.dataRequired === 'intraday_1m' || strategy.dataRequired === 'both' || strategy.timeframe === 'intraday');
  const needsNews = strategies.some((strategy) => ['catalyst', 'daily_catalyst', 'intraday_catalyst'].includes(String(strategy.category || '').toLowerCase()) || String(strategy.id || '').includes('news'));
  const needsEarnings = strategies.some((strategy) => String(strategy.id || '').includes('earnings') || String(strategy.category || '').toLowerCase().includes('earnings'));

  const [dailyBars, intradayBars, news, earnings] = await Promise.all([
    needsDaily && sharedData.hasDaily(symbol) ? fetchDailyBars(symbol) : Promise.resolve([]),
    needsIntraday && sharedData.hasIntraday(symbol) ? fetchIntradayBars(symbol) : Promise.resolve([]),
    needsNews ? fetchNewsForSymbol(symbol) : Promise.resolve([]),
    needsEarnings ? fetchEarningsForSymbol(symbol) : Promise.resolve([]),
  ]);

  return {
    dailyBars: sortBars(dailyBars, 'date'),
    intradayBars: sortBars(intradayBars, 'timestamp'),
    news,
    earnings,
  };
}

function resolveSubsequentBars(signal, strategy, dataset) {
  if (strategy.timeframe === 'intraday') {
    const bars = dataset.intradayBars || [];
    const entryTimestamp = signal.entryTimestamp || signal.metadata?.entryTimestamp;
    const index = bars.findIndex((bar) => String(bar.timestamp) === String(entryTimestamp));
    return index >= 0 ? bars.slice(index + 1) : [];
  }

  const bars = dataset.dailyBars || [];
  const entryDate = signal.entryDate || signal.metadata?.entryDate || signal.signal_date;
  const index = bars.findIndex((bar) => toDateKey(bar.date) === toDateKey(entryDate));
  return index >= 0 ? bars.slice(index) : [];
}

function normalizeBacktestRow(strategy, signal, evaluation) {
  return {
    strategy_id: strategy.id,
    symbol: signal.symbol,
    signal_date: signal.signal_date,
    direction: signal.direction,
    entry_price: signal.entryPrice,
    stop_price: signal.stopPrice,
    target_price: signal.targetPrice,
    exit_price: evaluation.exit_price,
    exit_reason: evaluation.exit_reason,
    bars_held: evaluation.bars_held,
    pnl_percent: evaluation.pnl_percent,
    pnl_r: evaluation.pnl_r,
    max_move_percent: evaluation.max_move_percent,
    max_drawdown_percent: evaluation.max_drawdown_percent,
    metadata: {
      ...signal.metadata,
      strategy_name: strategy.name,
      timeframe: strategy.timeframe,
      hold_period: strategy.holdPeriod,
      max_move: evaluation.max_move,
      max_drawdown: evaluation.max_drawdown,
      hit_target: evaluation.hit_target,
      hit_stop: evaluation.hit_stop,
    },
  };
}

async function persistBacktestRows(rows) {
  return upsertRows(
    RESULT_TABLE,
    rows,
    {
      strategy_id: 'text',
      symbol: 'text',
      signal_date: 'date',
      direction: 'text',
      entry_price: 'numeric',
      stop_price: 'numeric',
      target_price: 'numeric',
      exit_price: 'numeric',
      exit_reason: 'text',
      bars_held: 'integer',
      pnl_percent: 'numeric',
      pnl_r: 'numeric',
      max_move_percent: 'numeric',
      max_drawdown_percent: 'numeric',
      metadata: 'jsonb',
    },
    ['strategy_id', 'symbol', 'signal_date'],
    ['direction', 'entry_price', 'stop_price', 'target_price', 'exit_price', 'exit_reason', 'bars_held', 'pnl_percent', 'pnl_r', 'max_move_percent', 'max_drawdown_percent', 'metadata'],
    'backtester.engine.persist_signals'
  );
}

async function writeBacktestHeartbeat(runId, progress, options = {}) {
  if (!runId) {
    return false;
  }

  const queryFn = options.queryFn || queryWithTimeout;
  const heartbeatAt = progress.heartbeat_at || new Date().toISOString();
  const processed = Number(progress.processed || 0);
  const total = Number(progress.total || 0);
  const payload = {
    ...progress,
    processed,
    total,
    pct_complete: Number(progress.pct_complete || 0),
    heartbeat_at: heartbeatAt,
  };
  const metaPatch = {
    last_step: `backtest_processing_${processed}_of_${total}`,
    last_step_at: heartbeatAt,
  };

  try {
    await queryFn(
      `UPDATE beacon_nightly_runs
       SET updated_at = NOW(),
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{backtest_progress}',
             $2::jsonb,
             true
           ) || $3::jsonb
       WHERE id = $1`,
      [runId, JSON.stringify(payload), JSON.stringify(metaPatch)],
      {
        timeoutMs: 5000,
        label: `beacon_nightly.backtest_heartbeat.${runId}`,
        maxRetries: 0,
        poolType: 'write',
      }
    );
    return true;
  } catch (error) {
    console.warn('[beacon-nightly heartbeat] write failed:', error.message);
    return false;
  }
}

async function runBacktestEngine(options = {}) {
  const mode = options.mode || 'historical';
  const skipScoring = options.skipScoring === true;
  const skipPickGeneration = options.skipPickGeneration === true;
  const strategies = loadStrategyModules();
  const sharedData = await buildSharedDataCaches();
  const strategyIds = Array.isArray(options.strategyIds) && options.strategyIds.length
    ? new Set(options.strategyIds)
    : null;
  const symbolFilter = Array.isArray(options.symbols) && options.symbols.length
    ? new Set(options.symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))
    : null;
  let generatedSignals = 0;

  const activeStrategies = strategies.filter((strategy) => !strategyIds || strategyIds.has(strategy.id));
  const requestedSymbols = symbolFilter ? Array.from(symbolFilter).sort() : null;
  const symbolUniverse = new Set();
  if (requestedSymbols) {
    for (const symbol of requestedSymbols) {
      symbolUniverse.add(symbol);
    }
  } else {
    for (const strategy of activeStrategies) {
      for (const symbol of sharedData.symbolsByDataRequirement(strategy.dataRequired)) {
        symbolUniverse.add(symbol);
      }
    }
  }

  const orderedSymbols = Array.from(symbolUniverse).sort();
  const checkpointScope = buildCheckpointScope({
    mode,
    strategyIds: activeStrategies.map((strategy) => strategy.id),
    symbols: requestedSymbols,
  });
  const checkpointFile = options.checkpointRef || resolveCheckpointFile({
    ...options,
    mode,
    strategyIds: activeStrategies.map((strategy) => strategy.id),
    symbols: requestedSymbols,
  });
  const checkpointReader = typeof options.readCheckpoint === 'function'
    ? options.readCheckpoint
    : async (reference) => readCheckpoint(reference);
  const checkpointWriter = typeof options.writeCheckpoint === 'function'
    ? options.writeCheckpoint
    : async (reference, payload) => writeCheckpoint(reference, payload);
  const checkpointResetter = typeof options.resetCheckpointFn === 'function'
    ? options.resetCheckpointFn
    : async (reference) => removeFileIfExists(reference);
  const progressCallback = typeof options.onProgress === 'function' ? options.onProgress : null;
  if (options.resetCheckpoint === true) {
    await maybeAwait(checkpointResetter(checkpointFile));
  }
  const checkpointEnabled = options.useCheckpoint !== false;
  const checkpoint = checkpointEnabled ? await maybeAwait(checkpointReader(checkpointFile)) : null;
  let resumeIndex = 0;
  if (checkpointEnabled && checkpoint && checkpoint.scopeKey === checkpointScope.key && checkpoint.lastCompletedSymbol) {
    const checkpointSymbolIndex = orderedSymbols.findIndex((symbol) => symbol === checkpoint.lastCompletedSymbol);
    if (checkpointSymbolIndex >= 0) {
      resumeIndex = checkpointSymbolIndex + 1;
    }
  }
  let processedSymbols = 0;
  let persistedSignals = 0;
  let peakMemoryMb = 0;
  let symbolsSinceHeartbeat = 0;
  let lastHeartbeatTime = Date.now();
  const heartbeatRunId = options.beaconNightlyRunId || options.runId || null;
  const collectSymbolStats = options.collectSymbolStats === true || (requestedSymbols && requestedSymbols.length <= 25);
  const symbolStats = [];

  if (checkpointEnabled && checkpoint && checkpoint.scopeKey === checkpointScope.key && resumeIndex > 0) {
    processedSymbols = Number(checkpoint.processedSymbols || 0);
    persistedSignals = Number(checkpoint.persistedSignals || 0);
    peakMemoryMb = Number(checkpoint.peakMemoryMb || 0);
    logger.info(`[BACKFILL] Resuming from checkpoint at ${checkpoint.lastCompletedSymbol}. Starting with symbol ${orderedSymbols[resumeIndex] || 'complete'}.`);
  }

  if (checkpointEnabled && checkpoint && checkpoint.scopeKey !== checkpointScope.key) {
    logger.info('[BACKFILL] Existing checkpoint scope does not match current run. Starting from the beginning.');
  }

  async function persistProgress(payload) {
    if (checkpointEnabled) {
      await maybeAwait(checkpointWriter(checkpointFile, payload));
    }
    if (progressCallback) {
      await maybeAwait(progressCallback(payload));
    }
  }

  for (let symbolIndex = resumeIndex; symbolIndex < orderedSymbols.length; symbolIndex += 1) {
    const symbol = orderedSymbols[symbolIndex];
    const relevantStrategies = activeStrategies.filter((strategy) => {
      if (strategy.dataRequired === 'intraday_1m') return sharedData.hasIntraday(symbol);
      if (strategy.dataRequired === 'daily_ohlcv') return sharedData.hasDaily(symbol);
      return sharedData.hasDaily(symbol) && sharedData.hasIntraday(symbol);
    });
    if (!relevantStrategies.length) {
      processedSymbols += 1;
      symbolsSinceHeartbeat += 1;
      const heapUsageMb = getHeapUsageMbValue();
      peakMemoryMb = Math.max(peakMemoryMb, heapUsageMb);
      if (collectSymbolStats) {
        symbolStats.push({
          symbol,
          generatedSignals: 0,
          status: 'skipped_no_data',
          memoryMb: Number(heapUsageMb.toFixed(1)),
        });
      }
      await persistProgress({
        scopeKey: checkpointScope.key,
        scope: checkpointScope.normalized,
        mode,
        processedSymbols,
        totalSymbols: orderedSymbols.length,
        persistedSignals,
        peakMemoryMb: Number(peakMemoryMb.toFixed(1)),
        lastCompletedSymbol: symbol,
        updatedAt: new Date().toISOString(),
        status: 'running',
      });

      const heartbeatNow = Date.now();
      if (
        heartbeatRunId
        && (
          symbolsSinceHeartbeat >= BACKTEST_HEARTBEAT_SYMBOLS
          || (heartbeatNow - lastHeartbeatTime) >= BACKTEST_HEARTBEAT_MS
        )
      ) {
        const heartbeatWritten = await writeBacktestHeartbeat(heartbeatRunId, {
          processed: processedSymbols,
          total: orderedSymbols.length,
          current_symbol: symbol,
          pct_complete: Math.round((processedSymbols / Math.max(1, orderedSymbols.length)) * 100),
          persisted_signals: persistedSignals,
          heartbeat_at: new Date().toISOString(),
        });

        if (heartbeatWritten) {
          symbolsSinceHeartbeat = 0;
          lastHeartbeatTime = heartbeatNow;
        }
      }

      continue;
    }

    const dataset = await loadSymbolDataset(symbol, relevantStrategies, sharedData);
    const symbolRows = [];

    for (const strategy of relevantStrategies) {
      const sourceBars = sharedData.resolveBarsForStrategy(strategy, dataset);
      if (!Array.isArray(sourceBars) || !sourceBars.length) continue;

      const scanRange = mode === 'nightly'
        ? {
            startDate: strategy.timeframe === 'intraday' ? sharedData.latestIntradayDate : sharedData.latestDailyDate,
            endDate: strategy.timeframe === 'intraday' ? sharedData.latestIntradayDate : sharedData.latestDailyDate,
          }
        : options.scanRange || null;

      const context = sharedData.buildContext(symbol, dataset, { scanRange });
      const signals = await strategy.scan(symbol, sourceBars, context);
      if (!Array.isArray(signals) || !signals.length) continue;

      for (const signal of signals) {
        const subsequentBars = resolveSubsequentBars(signal, strategy, dataset);
        const evaluation = await strategy.evaluate(signal, subsequentBars, context);
        symbolRows.push(normalizeBacktestRow(strategy, signal, evaluation));
        generatedSignals += 1;
      }

      signals.length = 0;
    }

    if (symbolRows.length) {
      await persistBacktestRows(symbolRows);
      persistedSignals += symbolRows.length;
    }

    processedSymbols += 1;
    symbolsSinceHeartbeat += 1;

    const heapUsageMb = getHeapUsageMbValue();
    peakMemoryMb = Math.max(peakMemoryMb, heapUsageMb);

    if (collectSymbolStats) {
      symbolStats.push({
        symbol,
        generatedSignals: symbolRows.length,
        status: 'completed',
        memoryMb: Number(heapUsageMb.toFixed(1)),
      });
    }

    dataset.dailyBars = null;
    dataset.intradayBars = null;
    dataset.news = null;
    dataset.earnings = null;

    await persistProgress({
      scopeKey: checkpointScope.key,
      scope: checkpointScope.normalized,
      mode,
      processedSymbols,
      totalSymbols: orderedSymbols.length,
      persistedSignals,
      peakMemoryMb: Number(peakMemoryMb.toFixed(1)),
      lastCompletedSymbol: symbol,
      updatedAt: new Date().toISOString(),
      status: 'running',
    });

    const heartbeatNow = Date.now();
    if (
      heartbeatRunId
      && (
        symbolsSinceHeartbeat >= BACKTEST_HEARTBEAT_SYMBOLS
        || (heartbeatNow - lastHeartbeatTime) >= BACKTEST_HEARTBEAT_MS
      )
    ) {
      const heartbeatWritten = await writeBacktestHeartbeat(heartbeatRunId, {
        processed: processedSymbols,
        total: orderedSymbols.length,
        current_symbol: symbol,
        pct_complete: Math.round((processedSymbols / Math.max(1, orderedSymbols.length)) * 100),
        persisted_signals: persistedSignals,
        heartbeat_at: new Date().toISOString(),
      });

      if (heartbeatWritten) {
        symbolsSinceHeartbeat = 0;
        lastHeartbeatTime = heartbeatNow;
      }
    }

    if (processedSymbols % PROGRESS_EVERY_SYMBOLS === 0) {
      logger.info(`[BACKFILL] ${processedSymbols}/${orderedSymbols.length} symbols processed. ${persistedSignals} signals found. Memory: ${heapUsageMb.toFixed(1)}mb`);
    }

    maybeRunGc(processedSymbols);
  }

  await persistProgress({
    scopeKey: checkpointScope.key,
    scope: checkpointScope.normalized,
    mode,
    processedSymbols,
    totalSymbols: orderedSymbols.length,
    persistedSignals,
    peakMemoryMb: Number(peakMemoryMb.toFixed(1)),
    lastCompletedSymbol: orderedSymbols[orderedSymbols.length - 1] || null,
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'completed',
  });

  if (heartbeatRunId && processedSymbols > 0 && symbolsSinceHeartbeat > 0) {
    await writeBacktestHeartbeat(heartbeatRunId, {
      processed: processedSymbols,
      total: orderedSymbols.length,
      current_symbol: orderedSymbols[orderedSymbols.length - 1] || null,
      pct_complete: 100,
      persisted_signals: persistedSignals,
      heartbeat_at: new Date().toISOString(),
    });
  }

  logger.info(`[BACKFILL] ${processedSymbols}/${orderedSymbols.length} symbols processed. ${persistedSignals} signals found. Memory: ${getHeapUsageMb()}mb. Peak: ${peakMemoryMb.toFixed(1)}mb`);

  const scoring = skipScoring
    ? { rowsInserted: 0, skipped: true }
    : await calculateStrategyScores({ scoreDate: options.scoreDate || new Date() });

  const picks = skipPickGeneration
    ? { picksInserted: 0, skipped: true }
    : await require('./pickGenerator').generateMorningPicks({ scoreDate: options.scoreDate || new Date() });

  logger.info('backtest engine run complete', {
    scope: 'phase2_backtester',
    mode,
    strategies: activeStrategies.length,
    generatedSignals: persistedSignals,
    score_rows: scoring.rowsInserted,
    pick_rows: picks.picksInserted,
    skip_scoring: skipScoring,
    skip_pick_generation: skipPickGeneration,
  });

  return {
    mode,
    strategiesProcessed: activeStrategies.length,
    symbolsProcessed: processedSymbols,
    totalSymbols: orderedSymbols.length,
    generatedSignals: persistedSignals,
    scoreRows: scoring.rowsInserted,
    pickRows: picks.picksInserted,
    skipScoring,
    skipPickGeneration,
    peakMemoryMb: Number(peakMemoryMb.toFixed(1)),
    checkpointFile: checkpointEnabled ? checkpointFile : null,
    resumedFromCheckpoint: resumeIndex > 0,
    symbolStats: collectSymbolStats ? symbolStats : undefined,
  };
}

async function runHistoricalBackfill(options = {}) {
  return runBacktestEngine({ ...options, mode: 'historical' });
}

async function runNightlyIncrementalBacktest(options = {}) {
  return runBacktestEngine({ ...options, mode: 'nightly' });
}

module.exports = {
  RESULT_TABLE,
  buildSharedDataCaches,
  loadSymbolDataset,
  resolveCheckpointFile,
  runBacktestEngine,
  runHistoricalBackfill,
  runNightlyIncrementalBacktest,
  writeBacktestHeartbeat,
};