import axios from 'axios';
import { pool } from '../../db/pg';
import { getExpectedMove } from '../expectedMoveService';

export interface EarningsMarketReactionRecord {
  symbol: string;
  report_date: string;
  pre_market_gap_pct: number | null;
  open_gap_pct: number | null;
  high_of_day_pct: number | null;
  low_of_day_pct: number | null;
  close_pct: number | null;
  day2_followthrough_pct: number | null;
  volume_vs_avg: number | null;
  rvol: number | null;
  atr_pct: number | null;
  implied_move_pct: number | null;
  actual_move_pct: number | null;
  move_vs_implied_ratio: number | null;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctFrom(base: number | null, value: number | null): number | null {
  if (base == null || value == null || base === 0) return null;
  return ((value - base) / base) * 100;
}

function toYmd(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchDailyBars(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo&includePrePost=false&events=history`;
  const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  if (response.status !== 200) return [];

  const result = response.data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const bars = timestamps.map((ts: number, idx: number) => ({
    ts,
    date: toYmd(ts),
    open: toNumber(quote.open?.[idx]),
    high: toNumber(quote.high?.[idx]),
    low: toNumber(quote.low?.[idx]),
    close: toNumber(quote.close?.[idx]),
    volume: toNumber(quote.volume?.[idx]),
  })).filter((bar) => bar.close != null);

  return bars;
}

async function fetchIntradayBars(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=10d&includePrePost=true&events=history`;
  const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  if (response.status !== 200) return [];

  const result = response.data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps.map((ts: number, idx: number) => ({
    ts,
    date: toYmd(ts),
    hour: new Date(ts * 1000).getUTCHours(),
    minute: new Date(ts * 1000).getUTCMinutes(),
    close: toNumber(quote.close?.[idx]),
  })).filter((bar) => bar.close != null);
}

function computeAtrPct(bars: Array<any>, targetIndex: number, prevClose: number | null): number | null {
  if (prevClose == null || prevClose === 0 || targetIndex <= 0) return null;
  const start = Math.max(1, targetIndex - 20);
  const ranges: number[] = [];

  for (let i = start; i <= targetIndex; i += 1) {
    const current = bars[i];
    const prior = bars[i - 1];
    if (!current || !prior) continue;
    const high = toNumber(current.high);
    const low = toNumber(current.low);
    const priorClose = toNumber(prior.close);
    if (high == null || low == null || priorClose == null) continue;
    const tr = Math.max(
      high - low,
      Math.abs(high - priorClose),
      Math.abs(low - priorClose),
    );
    ranges.push(tr);
  }

  if (ranges.length === 0) return null;
  const atr = ranges.reduce((sum, n) => sum + n, 0) / ranges.length;
  return (atr / prevClose) * 100;
}

export async function calculateMarketReaction(symbol: string, reportDate: Date): Promise<EarningsMarketReactionRecord | null> {
  const safeSymbol = String(symbol || '').trim().toUpperCase();
  if (!safeSymbol) return null;
  if (!(reportDate instanceof Date) || Number.isNaN(reportDate.getTime())) return null;

  const reportDateStr = reportDate.toISOString().slice(0, 10);
  const [dailyBars, intradayBars] = await Promise.all([
    fetchDailyBars(safeSymbol),
    fetchIntradayBars(safeSymbol),
  ]);

  const dayIndex = dailyBars.findIndex((bar) => bar.date === reportDateStr);
  if (dayIndex <= 0) return null;

  const reportBar = dailyBars[dayIndex];
  const prevBar = dailyBars[dayIndex - 1];
  const day2Bar = dailyBars[dayIndex + 1] || null;
  const prevClose = toNumber(prevBar.close);

  const preMarketBars = intradayBars.filter((bar) => bar.date === reportDateStr && (bar.hour < 14 || (bar.hour === 14 && bar.minute < 30)));
  const preMarketLast = preMarketBars.length ? preMarketBars[preMarketBars.length - 1] : null;

  const openGapPct = pctFrom(prevClose, toNumber(reportBar.open));
  const highOfDayPct = pctFrom(prevClose, toNumber(reportBar.high));
  const lowOfDayPct = pctFrom(prevClose, toNumber(reportBar.low));
  const closePct = pctFrom(prevClose, toNumber(reportBar.close));
  const day2FollowthroughPct = reportBar.close != null && day2Bar?.close != null
    ? ((day2Bar.close - reportBar.close) / reportBar.close) * 100
    : null;

  const lookbackVolumes = dailyBars
    .slice(Math.max(0, dayIndex - 20), dayIndex)
    .map((bar) => toNumber(bar.volume))
    .filter((value): value is number => value != null);
  const avgVolume = lookbackVolumes.length > 0
    ? lookbackVolumes.reduce((sum, n) => sum + n, 0) / lookbackVolumes.length
    : null;
  const todayVolume = toNumber(reportBar.volume);
  const volumeVsAvg = avgVolume && todayVolume != null ? todayVolume / avgVolume : null;
  const rvol = volumeVsAvg;
  const atrPct = computeAtrPct(dailyBars, dayIndex, prevClose);

  const actualMovePct = closePct != null ? Math.abs(closePct) : null;

  const moveData = await getExpectedMove(safeSymbol, reportDateStr, 'earnings');
  const impliedMovePctRaw = moveData?.data?.impliedMovePct;
  const impliedMovePct = impliedMovePctRaw != null ? impliedMovePctRaw * 100 : null;
  const moveVsImpliedRatio = impliedMovePct && actualMovePct != null
    ? actualMovePct / impliedMovePct
    : null;

  const payload: EarningsMarketReactionRecord = {
    symbol: safeSymbol,
    report_date: reportDateStr,
    pre_market_gap_pct: pctFrom(prevClose, toNumber(preMarketLast?.close)),
    open_gap_pct: openGapPct,
    high_of_day_pct: highOfDayPct,
    low_of_day_pct: lowOfDayPct,
    close_pct: closePct,
    day2_followthrough_pct: day2FollowthroughPct,
    volume_vs_avg: volumeVsAvg,
    rvol,
    atr_pct: atrPct,
    implied_move_pct: impliedMovePct,
    actual_move_pct: actualMovePct,
    move_vs_implied_ratio: moveVsImpliedRatio,
  };

  const sql = `
    INSERT INTO earnings_market_reaction (
      symbol, report_date,
      pre_market_gap_pct, open_gap_pct,
      high_of_day_pct, low_of_day_pct,
      close_pct, day2_followthrough_pct,
      volume_vs_avg, rvol, atr_pct,
      implied_move_pct, actual_move_pct, move_vs_implied_ratio
    ) VALUES (
      $1, $2,
      $3, $4,
      $5, $6,
      $7, $8,
      $9, $10, $11,
      $12, $13, $14
    )
    RETURNING *
  `;

  const values = [
    payload.symbol,
    payload.report_date,
    payload.pre_market_gap_pct,
    payload.open_gap_pct,
    payload.high_of_day_pct,
    payload.low_of_day_pct,
    payload.close_pct,
    payload.day2_followthrough_pct,
    payload.volume_vs_avg,
    payload.rvol,
    payload.atr_pct,
    payload.implied_move_pct,
    payload.actual_move_pct,
    payload.move_vs_implied_ratio,
  ];

  const result = await pool.query(sql, values);
  return result.rows[0] || payload;
}