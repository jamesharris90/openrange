import { useMemo } from 'react';

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Mode = 'execution' | 'trend';

export type Indicators = {
  mode: Mode;
  ema9: Array<{ time: number; value: number }>;
  ema20: Array<{ time: number; value: number }>;
  ema50: Array<{ time: number; value: number }>;
  ema200: Array<{ time: number; value: number }>;
  vwap: Array<{ time: number; value: number }>;
  macdLine: Array<{ time: number; value: number }>;
  signalLine: Array<{ time: number; value: number }>;
  macdHist: Array<{ time: number; value: number; color: string }>;
  pdh: number | null;
  pdl: number | null;
  premarketHigh: number | null;
  premarketLow: number | null;
  atrPercent: number | null;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calcEMA(candles: Candle[], period: number): Array<{ time: number; value: number }> {
  if (!candles.length) return [];
  const k = 2 / (period + 1);
  let running = num(candles[0].close);
  return candles.map((candle) => {
    running = num(candle.close) * k + running * (1 - k);
    return { time: candle.time, value: running };
  });
}

function calcVWAP(candles: Candle[]): Array<{ time: number; value: number }> {
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const typical = (num(candle.high) + num(candle.low) + num(candle.close)) / 3;
    const volume = Math.max(0, num(candle.volume));
    cumulativePV += typical * volume;
    cumulativeVolume += volume;
    return {
      time: candle.time,
      value: cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : num(candle.close),
    };
  });
}

function calcMACD(candles: Candle[]) {
  const ema12 = calcEMA(candles, 12);
  const ema26 = calcEMA(candles, 26);
  const macdLine = ema12.map((point, idx) => ({
    time: point.time,
    value: point.value - (ema26[idx]?.value ?? point.value),
  }));
  const signalLine = calcEMA(
    macdLine.map((point) => ({
      time: point.time,
      open: point.value,
      high: point.value,
      low: point.value,
      close: point.value,
      volume: 0,
    })),
    9,
  );

  const macdHist = macdLine.map((point, idx) => {
    const signal = signalLine[idx]?.value ?? 0;
    const value = point.value - signal;
    return {
      time: point.time,
      value,
      color: value >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)',
    };
  });

  return { macdLine, signalLine, macdHist };
}

function calcATRPercent(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trValues: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const tr = Math.max(
      num(current.high) - num(current.low),
      Math.abs(num(current.high) - num(previous.close)),
      Math.abs(num(current.low) - num(previous.close)),
    );
    trValues.push(tr);
  }
  if (trValues.length < period) return null;
  const latestAtr = trValues.slice(-period).reduce((sum, value) => sum + value, 0) / period;
  const close = num(candles[candles.length - 1]?.close);
  if (close <= 0) return null;
  return (latestAtr / close) * 100;
}

function dayKeyFromUnix(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toISOString().slice(0, 10);
}

function etHoursMinutes(unixSeconds: number): { hour: number; minute: number } {
  const date = new Date(unixSeconds * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

function isAfterOpenEt(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour > 9 || (hour === 9 && minute >= 30);
}

export function useChartIndicators(candles: Candle[], dailyCandles: Candle[], timeframe: string): Indicators {
  return useMemo(() => {
    const mode: Mode = timeframe === '1D' ? 'trend' : 'execution';

    const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
    const sortedDaily = [...dailyCandles].sort((a, b) => a.time - b.time);

    const ema9 = calcEMA(sortedCandles, 9);
    const ema20 = calcEMA(mode === 'trend' ? sortedDaily : sortedCandles, 20);
    const ema50 = calcEMA(sortedCandles, 50);
    const ema200 = calcEMA(sortedCandles, 200);
    const vwap = calcVWAP(sortedCandles);
    const { macdLine, signalLine, macdHist } = calcMACD(sortedCandles);

    const previousDay = sortedDaily.length > 1 ? sortedDaily[sortedDaily.length - 2] : null;
    const pdh = previousDay ? num(previousDay.high) : null;
    const pdl = previousDay ? num(previousDay.low) : null;

    let premarketHigh: number | null = null;
    let premarketLow: number | null = null;
    if (isAfterOpenEt()) {
      const today = dayKeyFromUnix(sortedCandles[sortedCandles.length - 1]?.time ?? 0);
      const pre = sortedCandles.filter((candle) => {
        if (dayKeyFromUnix(candle.time) !== today) return false;
        const { hour, minute } = etHoursMinutes(candle.time);
        const inPremarket = hour > 4 && hour < 9;
        const exactlyStart = hour === 4 && minute >= 0;
        const beforeOpen = hour === 9 ? minute < 30 : true;
        return (inPremarket || exactlyStart) && beforeOpen;
      });
      if (pre.length) {
        premarketHigh = Math.max(...pre.map((candle) => num(candle.high)));
        premarketLow = Math.min(...pre.map((candle) => num(candle.low)));
      }
    }

    const atrPercent = calcATRPercent(mode === 'trend' ? sortedDaily : sortedCandles, 14);

    return {
      mode,
      ema9,
      ema20,
      ema50,
      ema200,
      vwap,
      macdLine,
      signalLine,
      macdHist,
      pdh,
      pdl,
      premarketHigh,
      premarketLow,
      atrPercent,
    };
  }, [candles, dailyCandles, timeframe]);
}
