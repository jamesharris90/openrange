const { pool } = require('../../db/pg');
const tradeModel = require('./tradeModel');

const SYMBOLS = [
  { sym: 'AAPL', range: [170, 195] },
  { sym: 'MSFT', range: [390, 420] },
  { sym: 'NVDA', range: [110, 140] },
  { sym: 'META', range: [480, 530] },
  { sym: 'TSLA', range: [220, 280] },
  { sym: 'SPY',  range: [500, 530] },
  { sym: 'QQQ',  range: [420, 450] },
  { sym: 'AMD',  range: [140, 170] },
];

const SETUP_TYPES = ['breakout', 'pullback', 'gap fill', 'momentum', 'reversal'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

function generateTrades(count = 14) {
  const trades = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const { sym, range } = pick(SYMBOLS);
    const isLong = Math.random() < 0.7;
    const side = isLong ? 'long' : 'short';
    const entry = +rand(range[0], range[1]).toFixed(2);

    // ~58% win rate
    const isWin = Math.random() < 0.58;
    const movePct = rand(0.3, 3.5) / 100;
    const direction = isWin ? (isLong ? 1 : -1) : (isLong ? -1 : 1);
    const exit = +(entry * (1 + direction * movePct)).toFixed(2);

    const qty = randInt(10, 200);
    const commission = +(rand(0.5, 2.0)).toFixed(2);
    const pnlDollar = +(((isLong ? exit - entry : entry - exit) * qty) - commission).toFixed(2);
    const pnlPercent = +(((isLong ? exit - entry : entry - exit) / entry) * 100).toFixed(4);

    // Spread across last 30 days
    const daysAgo = randInt(0, 29);
    const hour = randInt(9, 15);
    const minute = randInt(0, 59);
    const openTime = new Date(now - daysAgo * 86400000);
    openTime.setHours(hour, minute, 0, 0);

    const durationMin = randInt(5, 240);
    const closeTime = new Date(openTime.getTime() + durationMin * 60000);

    trades.push({
      symbol: sym,
      side,
      entryPrice: entry,
      exitPrice: exit,
      qty,
      pnlDollar,
      pnlPercent,
      commissionTotal: commission,
      openedAt: openTime.toISOString(),
      closedAt: closeTime.toISOString(),
      durationSeconds: durationMin * 60,
      status: 'closed',
      // Metadata for ~60% of trades
      setupType: Math.random() < 0.6 ? pick(SETUP_TYPES) : null,
      conviction: Math.random() < 0.6 ? randInt(1, 5) : null,
      notes: Math.random() < 0.4 ? `Demo trade on ${sym}. ${isWin ? 'Clean entry, held to target.' : 'Stopped out, need to review sizing.'}` : null,
    });
  }

  return trades;
}

function generateReviews(trades) {
  // Group trades by date
  const byDate = {};
  for (const t of trades) {
    const date = t.closedAt.slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(t);
  }

  const reviews = [];
  const dates = Object.keys(byDate).sort();
  // Create reviews for ~70% of trading days
  for (const date of dates) {
    if (Math.random() > 0.7) continue;
    const dayTrades = byDate[date];
    const totalPnl = dayTrades.reduce((s, t) => s + t.pnlDollar, 0);
    const wins = dayTrades.filter(t => t.pnlDollar > 0).length;
    const winRate = dayTrades.length > 0 ? +((wins / dayTrades.length) * 100).toFixed(2) : 0;

    const summaries = [
      'Solid day overall. Stuck to the plan and managed risk well.',
      'Mixed results today. A few good setups but gave back profits on overtrading.',
      'Great day! Caught the momentum early and rode the trend.',
      'Tough day. Market was choppy and I forced trades. Need more patience.',
      'Decent session. Focused on quality setups and cut losers quickly.',
    ];

    reviews.push({
      reviewDate: date,
      totalPnl: +totalPnl.toFixed(2),
      totalTrades: dayTrades.length,
      winRate,
      summaryText: pick(summaries),
      lessonsText: Math.random() < 0.5 ? 'Wait for confirmation before entering. Size down in choppy conditions.' : null,
      planTomorrow: Math.random() < 0.4 ? 'Focus on gap plays at open. Watch for FOMC volatility.' : null,
      mood: randInt(2, 5),
      rating: randInt(2, 5),
    });
  }

  return reviews;
}

async function seedDemoData(userId) {
  const trades = generateTrades(14);
  const reviews = generateReviews(trades);
  const tradeIds = [];

  for (const t of trades) {
    // Insert broker executions (buy + sell pair)
    const buySide = t.side === 'long' ? 'buy' : 'sell';
    const sellSide = t.side === 'long' ? 'sell' : 'buy';

    await tradeModel.insertExecution({
      userId, datasetScope: 'demo', broker: 'demo', symbol: t.symbol,
      side: buySide, qty: t.qty, price: t.entryPrice, commission: +(t.commissionTotal / 2).toFixed(2),
      execTime: t.openedAt,
    });

    await tradeModel.insertExecution({
      userId, datasetScope: 'demo', broker: 'demo', symbol: t.symbol,
      side: sellSide, qty: t.qty, price: t.exitPrice, commission: +(t.commissionTotal / 2).toFixed(2),
      execTime: t.closedAt,
    });

    // Insert trade
    const row = await tradeModel.insertTrade({
      userId, datasetScope: 'demo', symbol: t.symbol, side: t.side,
      entryPrice: t.entryPrice, exitPrice: t.exitPrice, qty: t.qty,
      pnlDollar: t.pnlDollar, pnlPercent: t.pnlPercent,
      commissionTotal: t.commissionTotal, openedAt: t.openedAt,
      closedAt: t.closedAt, durationSeconds: t.durationSeconds, status: t.status,
    });

    tradeIds.push(row.trade_id);

    // Insert metadata if present
    if (t.setupType || t.conviction || t.notes) {
      await tradeModel.upsertMetadata(row.trade_id, {
        setupType: t.setupType, conviction: t.conviction, notes: t.notes,
      });
    }
  }

  // Insert daily reviews
  for (const r of reviews) {
    await tradeModel.upsertDailyReview({
      userId, datasetScope: 'demo', ...r,
    });
  }

  return { trades: tradeIds.length, reviews: reviews.length };
}

async function clearDemoData(userId) {
  await pool.query("DELETE FROM daily_reviews WHERE user_id = $1 AND dataset_scope = 'demo'", [userId]);
  await pool.query("DELETE FROM trades WHERE user_id = $1 AND dataset_scope = 'demo'", [userId]);
  await pool.query("DELETE FROM broker_executions WHERE user_id = $1 AND dataset_scope = 'demo'", [userId]);
  return { cleared: true };
}

module.exports = { seedDemoData, clearDemoData };
