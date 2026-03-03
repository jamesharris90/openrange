import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type MouseEventParams,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { type ChartProfile } from './indicatorRegistry';
import { chartSyncBus } from './SyncBus';
import type { Candle, Indicators, Levels } from '../../context/symbol/types';
import { buildEventMarkers, buildLevelDefinitions, updateOrBoxElement } from './overlays';
import { authFetch } from '../../utils/api';
import { normalizeTimeframe } from '../../utils/timeframe';
import { useAppStore } from '../../store/useAppStore';

type IndicatorState = {
  ema9: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  vwap: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
  structures: boolean;
};

const emaPeriods = [9, 20, 50, 200] as const;
type EmaPeriod = (typeof emaPeriods)[number];

type EventPoint = {
  type: string;
  time: number | Time;
  epochSec?: number;
  major?: boolean;
  symbol: string;
  title: string;
  url?: string | null;
  payload?: any;
};

type EventPayload =
  | any[]
  | {
      earnings?: any[];
      news?: any[];
    };

type DrawingItem = {
  id: string;
  type: string;
  price: number;
  label: string;
};

type OverlayKey = 'none' | 'SPY' | 'QQQ' | 'SECTOR';

type OhlcHeader = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
};

type StaircaseDirection = 'UP' | 'DOWN';

type StaircaseDetection = {
  type: StaircaseDirection;
  startIndex: number;
  endIndex: number;
  legCount: number;
  strengthScore: number;
  volumeAlignment: boolean;
  vwapAlignment: boolean;
  emaSlopePositive: boolean;
  rangeHash: string;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
};

type CockpitFetchPayload = {
  candles: Candle[];
  indicators: Indicators;
  levels: Levels;
  events: EventPayload;
  lastUpdateTime?: number;
};

const cockpitInflightRequestMap = new Map<string, Promise<CockpitFetchPayload>>();
const cockpitResolvedDataMap = new Map<string, CockpitFetchPayload>();

type Props = {
  symbol: string;
  timeframe: string;
  mode?: 'cockpit' | 'default';
  profile: ChartProfile;
  candles: Candle[];
  lastUpdateTime?: number;
  indicators: Indicators;
  levels: Levels;
  events: EventPayload;
  indicatorState: IndicatorState;
  marketOverlay: OverlayKey;
  sectorEtfSymbol: string | null;
  patternMode: boolean;
  loading: boolean;
  error: string;
  chartId: string;
  crosshairSyncEnabled?: boolean;
};

export default function ChartEngine({
  symbol,
  timeframe,
  mode,
  profile,
  candles,
  lastUpdateTime,
  indicators,
  levels,
  events,
  indicatorState,
  marketOverlay,
  sectorEtfSymbol,
  patternMode,
  loading,
  error,
  chartId,
  crosshairSyncEnabled = true,
}: Props) {
  const IS_DEV = (import.meta as any)?.env?.DEV === true;
  const theme = useAppStore((state) => state.theme);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const orBoxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Math.floor(Math.random() * 1000000);
  }
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const eventMarkerApiRef = useRef<any>(null);
  const levelLinesRef = useRef<Array<{ series: ISeriesApi<'Candlestick'>; line: IPriceLine }>>([]);
  const drawingLinesRef = useRef<Array<{ id: string; line: IPriceLine }>>([]);
  const drawingRowsRef = useRef<DrawingItem[]>([]);
  const lastDatasetKeyRef = useRef<string>('');
  const previousCandlesRef = useRef<Candle[]>([]);
  const previousSymbolRef = useRef<string>(symbol);
  const previousTimeframeRef = useRef<string>(timeframe);
  const profileRef = useRef<ChartProfile>(profile);
  const levelsRef = useRef<Levels>(levels);
  const indicatorStateRef = useRef<IndicatorState>(indicatorState);
  const devWarnedRemountRef = useRef(false);
  const visibleRangeCallbackRef = useRef<(() => void) | null>(null);
  const crosshairCallbackRef = useRef<((param: MouseEventParams<Time>) => void) | null>(null);
  const macdPaneIndexRef = useRef<number | null>(null);
  const sortedCandlesRef = useRef<Candle[]>([]);
  const headerRef = useRef<OhlcHeader | null>(null);
  const markerByTimeRef = useRef<Map<number, EventPoint[]>>(new Map());
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const overlayCacheRef = useRef<Map<string, Candle[]>>(new Map());
  const overlayInflightRef = useRef<Map<string, Promise<Candle[]>>>(new Map());
  const indicatorsRef = useRef<Indicators>(indicators);
  const patternVisibleRangeCallbackRef = useRef<(() => void) | null>(null);
  const patternResultRef = useRef<StaircaseDetection | null>(null);
  const patternScanCacheRef = useRef<Map<string, StaircaseDetection | null>>(new Map());
  const patternScanCountRef = useRef<number>(0);
  const patternCurrentScanKeyRef = useRef<string>('');
  const patternDismissedScanKeyRef = useRef<string>('');
  const patternPopupRef = useRef<HTMLDivElement | null>(null);
  const patternDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const chartIdRef = useRef<string>(chartId);
  const crosshairSyncEnabledRef = useRef<boolean>(crosshairSyncEnabled);
  const suppressNextCrosshairEmitRef = useRef(false);
  const lastEmittedSyncTimeRef = useRef<number | null>(null);
  const lastAppliedSyncTimeRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const emaSeriesRefs = useRef<Record<EmaPeriod, ISeriesApi<'Line'> | null>>({
    9: null,
    20: null,
    50: null,
    200: null,
  });

  const [ohlcHeader, setOhlcHeader] = useState<OhlcHeader | null>(null);
  const [patternPopup, setPatternPopup] = useState<{ open: boolean; x: number; y: number; data: StaircaseDetection | null }>({
    open: false,
    x: 0,
    y: 0,
    data: null,
  });
  const [patternDragging, setPatternDragging] = useState(false);
  const [drawings, setDrawings] = useState<DrawingItem[]>([]);
  const [cockpitData, setCockpitData] = useState<{
    candles: Candle[];
    indicators: Indicators;
    levels: Levels;
    events: EventPayload;
    loading: boolean;
    error: string;
    lastUpdateTime?: number;
  }>({
    candles: [],
    indicators: {},
    levels: {},
    events: [],
    loading: false,
    error: '',
    lastUpdateTime: undefined,
  });

  useEffect(() => {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedTimeframe = String(timeframe || '').trim();
    if (!normalizedSymbol || !normalizedTimeframe) {
      setDrawings([]);
      return;
    }

    const controller = new AbortController();
    let active = true;

    const run = async () => {
      try {
        const response = await authFetch(
          `/api/v5/drawings?symbol=${encodeURIComponent(normalizedSymbol)}&timeframe=${encodeURIComponent(normalizedTimeframe)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          if (!active) return;
          setDrawings([]);
          return;
        }

        const payload = await response.json();
        if (!active) return;
        const rows = Array.isArray(payload)
          ? payload
            .map((item: any, index: number) => ({
              id: String(item?.id || `${normalizedSymbol}-${normalizedTimeframe}-${index}`),
              type: String(item?.type || 'hline'),
              price: Number(item?.price),
              label: String(item?.label || 'Line'),
            }))
            .filter((item: DrawingItem) => Number.isFinite(item.price))
          : [];
        setDrawings(rows);
      } catch (error: any) {
        if (error?.name !== 'AbortError' && active) {
          setDrawings([]);
        }
      }
    };

    run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    chartIdRef.current = chartId;
  }, [chartId]);

  useEffect(() => {
    drawingRowsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    crosshairSyncEnabledRef.current = Boolean(crosshairSyncEnabled);
  }, [crosshairSyncEnabled]);

  useEffect(() => {
    lastEmittedSyncTimeRef.current = null;
    lastAppliedSyncTimeRef.current = null;
  }, [symbol, timeframe]);

  const isCockpitMode = mode === 'cockpit';

  const parseCandles = (input: unknown): Candle[] => {
    if (!Array.isArray(input)) return [];
    return input
      .map((item: any) => ({
        time: Number(item?.time),
        open: Number(item?.open),
        high: Number(item?.high),
        low: Number(item?.low),
        close: Number(item?.close),
        volume: Number(item?.volume ?? 0),
      }))
      .filter((item: Candle) => [item.time, item.open, item.high, item.low, item.close].every(Number.isFinite));
  };

  const extractIndicatorValues = (input: unknown): number[] => {
    if (!Array.isArray(input)) return [];
    return input
      .map((item: any) => {
        const value = typeof item === 'object' && item !== null ? item.value : item;
        return Number(value);
      })
      .filter(Number.isFinite);
  };

  const toFiniteNumber = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  useEffect(() => {
    if (!symbol || String(symbol).trim() === '') return;
    if (!isCockpitMode) return;

    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    const normalizedTimeframe = normalizeTimeframe(String(timeframe || ''));
    if (!normalizedSymbol || !normalizedTimeframe) {
      setCockpitData({
        candles: [],
        indicators: {},
        levels: {},
        events: [],
        loading: false,
        error: 'Symbol/timeframe required',
        lastUpdateTime: undefined,
      });
      return;
    }

    if (abortRef.current && !abortRef.current.signal.aborted) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let disposed = false;

    setCockpitData((prev) => ({
      candles: [],
      indicators: {},
      levels: {},
      events: [],
      loading: true,
      error: '',
      lastUpdateTime: undefined,
    }));

    const run = async () => {
      try {
        const requestKey = `${normalizedSymbol}|${normalizedTimeframe}`;

        let nextPayload = cockpitResolvedDataMap.get(requestKey);

        if (!nextPayload) {
          const existingInflight = cockpitInflightRequestMap.get(requestKey);
          if (existingInflight) {
            nextPayload = await existingInflight;
          } else {
            const requestPromise = (async (): Promise<CockpitFetchPayload> => {
              const query = new URLSearchParams({
                symbol: normalizedSymbol,
                timeframe: normalizedTimeframe,
                interval: toInterval(normalizedTimeframe),
              }).toString();

              const response = await authFetch(`/api/v5/chart?${query}`, { signal: controller.signal });
              if (!response.ok) {
                const bodyText = await response.text();
                throw new Error(bodyText || `Chart API failed (${response.status})`);
              }

              const payload = await response.json();
              const nextCandles = parseCandles(payload?.candles);
              return {
                candles: nextCandles,
                indicators: {
                  vwap: extractIndicatorValues(payload?.indicators?.vwap),
                  ema9: extractIndicatorValues(payload?.indicators?.ema9),
                  ema10: extractIndicatorValues(payload?.indicators?.ema10),
                  ema20: extractIndicatorValues(payload?.indicators?.ema20),
                  ema50: extractIndicatorValues(payload?.indicators?.ema50),
                  ema200: extractIndicatorValues(payload?.indicators?.ema200),
                  rsi14: extractIndicatorValues(payload?.indicators?.rsi14),
                  macd: extractIndicatorValues(payload?.indicators?.macd),
                  atr14: extractIndicatorValues(payload?.indicators?.atr),
                  volumeMA20: [],
                },
                levels: {
                  pdh: toFiniteNumber(payload?.pdh),
                  pdl: toFiniteNumber(payload?.pdl),
                  pmh: toFiniteNumber(payload?.pmh),
                  pml: toFiniteNumber(payload?.pml),
                  orHigh: toFiniteNumber(payload?.orh),
                  orLow: toFiniteNumber(payload?.orl),
                  orStartTime: toFiniteNumber(payload?.orStartTime),
                  orEndTime: toFiniteNumber(payload?.orEndTime),
                },
                events: Array.isArray(payload?.events)
                  ? payload.events
                  : (payload?.events && typeof payload.events === 'object')
                    ? payload.events
                    : [],
                lastUpdateTime: nextCandles.length ? nextCandles[nextCandles.length - 1].time : undefined,
              };
            })();

            cockpitInflightRequestMap.set(requestKey, requestPromise);
            try {
              nextPayload = await requestPromise;
              cockpitResolvedDataMap.set(requestKey, nextPayload);
            } finally {
              cockpitInflightRequestMap.delete(requestKey);
            }
          }
        }

        if (disposed || controller.signal.aborted) return;
        if (!nextPayload) return;

        setCockpitData({
          candles: nextPayload.candles,
          indicators: nextPayload.indicators,
          levels: nextPayload.levels,
          events: nextPayload.events,
          loading: false,
          error: '',
          lastUpdateTime: nextPayload.lastUpdateTime,
        });
      } catch (fetchError: any) {
        if (disposed || fetchError?.name === 'AbortError' || controller.signal.aborted) return;
        setCockpitData((prev) => ({
          ...prev,
          loading: false,
          error: fetchError?.message || 'Failed to fetch chart data',
        }));
      }
    };

    run();

    return () => {
      disposed = true;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [symbol, timeframe, isCockpitMode]);

  const safeIndicators = (isCockpitMode ? cockpitData.indicators : indicators) || {};
  const safeLevels = (isCockpitMode ? cockpitData.levels : levels) || {};
  const safeCandles = Array.isArray(isCockpitMode ? cockpitData.candles : candles)
    ? (isCockpitMode ? cockpitData.candles : candles)
    : [];
  const safeEvents = (isCockpitMode ? cockpitData.events : events) || [];
  const effectiveLoading = isCockpitMode ? cockpitData.loading : loading;
  const effectiveError = isCockpitMode ? cockpitData.error : error;
  const effectiveLastUpdateTime = isCockpitMode ? cockpitData.lastUpdateTime : lastUpdateTime;

  const toEtDateParts = (epochSec: number) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(epochSec * 1000));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
    };
  };

  const getEtOffsetMinutes = (utcMs: number) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const tz = parts.find((part) => part.type === 'timeZoneName')?.value || '';
    const match = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * ((hours * 60) + minutes);
  };

  const toEtWallTimeEpochSec = (year: number, month: number, day: number, hour: number, minute: number) => {
    const wallUtcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
    const offsetMinutes = getEtOffsetMinutes(wallUtcGuess);
    if (!Number.isFinite(Number(offsetMinutes))) return null;
    return Math.floor((wallUtcGuess - ((offsetMinutes as number) * 60 * 1000)) / 1000);
  };

  const toHeaderFromCandle = (candle: Candle | null, candleIndex: number, candleList: Candle[]): OhlcHeader | null => {
    if (!candle) return null;

    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    const volume = Number(candle.volume || 0);

    const resolvedIndexFromList = candleList.findIndex((item) => Number(item.time) === Number(candle.time));
    const resolvedIndex = resolvedIndexFromList >= 0
      ? resolvedIndexFromList
      : candleIndex;

    const priorFromList = resolvedIndex > 0
      ? Number(candleList[resolvedIndex - 1]?.close)
      : NaN;
    const priorFromPayload = Number((safeLevels as any)?.previousClose ?? (safeLevels as any)?.prevClose);

    const previousCloseRaw = Number.isFinite(priorFromList)
      ? priorFromList
      : Number.isFinite(priorFromPayload)
        ? priorFromPayload
        : open;

    const previousClose = previousCloseRaw === 0 ? open : previousCloseRaw;
    const changeRaw = close - previousClose;
    const changePctRaw = previousClose !== 0 ? (changeRaw / previousClose) * 100 : 0;

    const change = Number.isFinite(changeRaw) ? Number(changeRaw.toFixed(2)) : 0;
    const changePct = Number.isFinite(changePctRaw) ? Number(changePctRaw.toFixed(2)) : 0;

    return {
      open,
      high,
      low,
      close,
      volume,
      change,
      changePct,
    };
  };

  const toInterval = (tf: string) => {
    const normalizedTf = String(tf || '').trim();
    if (normalizedTf === 'ALL') return '1day';
    if (normalizedTf === '1W' || normalizedTf === '1w') return '1week';
    if (normalizedTf === '1D' || normalizedTf === '1d') return '1day';
    if (normalizedTf === '4H' || normalizedTf === '4h') return '4hour';
    if (normalizedTf === '1H' || normalizedTf === '1h') return '1hour';
    if (normalizedTf === '15m') return '15min';
    if (normalizedTf === '3m') return '3min';
    if (normalizedTf === '5m') return '5min';
    return '1min';
  };

  const toSec = (raw: unknown): number | null => {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) {
      return asNum > 10_000_000_000 ? Math.floor(asNum / 1000) : Math.floor(asNum);
    }
    const parsed = Date.parse(String(raw || ''));
    if (!Number.isFinite(parsed)) return null;
    return Math.floor(parsed / 1000);
  };

  const findNearestCandleTime = (targetSec: number, list: Candle[]): number | null => {
    if (!list.length) return null;
    let best = list[0].time;
    let bestDiff = Math.abs(Number(best) - targetSec);
    for (let i = 1; i < list.length; i += 1) {
      const current = Number(list[i].time);
      const diff = Math.abs(current - targetSec);
      if (diff < bestDiff) {
        best = current;
        bestDiff = diff;
      }
    }
    return Number(best);
  };

  const alignToNearestCandle = (eventTime: number, candlesList: Candle[]) => {
    if (!Array.isArray(candlesList) || !candlesList.length) return eventTime;

    let closest = Number(candlesList[0].time);
    let minDiff = Math.abs(Number(eventTime) - closest);

    for (const candle of candlesList) {
      const candleTime = Number(candle?.time);
      const diff = Math.abs(Number(eventTime) - candleTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = candleTime;
      }
    }

    return closest;
  };

  const toBusinessDay = (unixTime: number) => {
    const date = new Date(Number(unixTime) * 1000);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    } as Time;
  };

  const computeEMAValues = (values: number[], period: number): Array<number | null> => {
    if (!Array.isArray(values) || values.length < period) return values.map(() => null);
    const result: Array<number | null> = new Array(values.length).fill(null);
    let sum = 0;
    for (let index = 0; index < period; index += 1) {
      sum += values[index];
    }
    const multiplier = 2 / (period + 1);
    let prevEma = sum / period;
    result[period - 1] = prevEma;

    for (let index = period; index < values.length; index += 1) {
      const nextEma = ((values[index] - prevEma) * multiplier) + prevEma;
      result[index] = nextEma;
      prevEma = nextEma;
    }

    return result;
  };

  const buildMacdSeries = (list: Candle[]) => {
    if (!Array.isArray(list) || list.length < 35) {
      return {
        macd: [] as Array<{ time: Time; value: number }>,
        signal: [] as Array<{ time: Time; value: number }>,
        histogram: [] as Array<{ time: Time; value: number; color: string }>,
      };
    }

    const closes = list.map((candle) => Number(candle.close));
    const ema12 = computeEMAValues(closes, 12);
    const ema26 = computeEMAValues(closes, 26);
    const macdValues = closes.map((_, index) => {
      if (!Number.isFinite(ema12[index]) || !Number.isFinite(ema26[index])) return null;
      return Number(ema12[index]) - Number(ema26[index]);
    });

    const macdForSignal = macdValues.map((value) => (Number.isFinite(value) ? Number(value) : 0));
    const signalValues = computeEMAValues(macdForSignal, 9);

    const macd: Array<{ time: Time; value: number }> = [];
    const signal: Array<{ time: Time; value: number }> = [];
    const histogram: Array<{ time: Time; value: number; color: string }> = [];

    for (let index = 0; index < list.length; index += 1) {
      const macdValue = macdValues[index];
      const signalValue = signalValues[index];
      if (!Number.isFinite(macdValue) || !Number.isFinite(signalValue)) continue;
      const histValue = Number(macdValue) - Number(signalValue);
      const time = list[index].time as Time;
      macd.push({ time, value: Number(macdValue) });
      signal.push({ time, value: Number(signalValue) });
      histogram.push({
        time,
        value: histValue,
        color: histValue >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)',
      });
    }

    return { macd, signal, histogram };
  };

  const buildEmaSeries = (list: Candle[], period: EmaPeriod): Array<{ time: Time; value: number }> => {
    if (!Array.isArray(list) || !list.length) return [];
    const closes = list.map((candle) => Number(candle.close));
    const emaValues = computeEMAValues(closes, period);
    const result: Array<{ time: Time; value: number }> = [];
    for (let index = 0; index < list.length; index += 1) {
      const value = emaValues[index];
      if (!Number.isFinite(value)) continue;
      result.push({
        time: list[index].time as Time,
        value: Number(value),
      });
    }
    return result;
  };

  const buildVwapSeries = (list: Candle[], tf: string): Array<{ time: Time; value: number }> => {
    const normalizedTimeframe = normalizeTimeframe(String(tf || ''));
    if (normalizedTimeframe === '1D') return [];

    if (!Array.isArray(list) || !list.length) return [];
    if (normalizedTimeframe === '5m' && list.length < 50) {
      console.warn('[VWAPData] 5m intraday bars < 50; backend data depth may be insufficient');
    }

    const etSessionKeyFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    let activeSession = '';
    let cumulativePV = 0;
    let cumulativeVolume = 0;
    const result: Array<{ time: Time; value: number }> = [];

    for (let index = 0; index < list.length; index += 1) {
      const candle = list[index];
      const timeSec = Number(candle?.time);
      const close = Number(candle?.close);
      const volume = Number(candle?.volume || 0);
      if (!Number.isFinite(timeSec) || !Number.isFinite(close) || !Number.isFinite(volume)) continue;

      const sessionKey = etSessionKeyFormatter.format(new Date(timeSec * 1000));
      if (sessionKey !== activeSession) {
        activeSession = sessionKey;
        cumulativePV = 0;
        cumulativeVolume = 0;
      }

      cumulativePV += close * volume;
      cumulativeVolume += volume;
      if (cumulativeVolume <= 0) continue;

      result.push({
        time: timeSec as Time,
        value: cumulativePV / cumulativeVolume,
      });
    }

    return result;
  };

  const parseEvents = (payload: EventPayload, list: Candle[]): EventPoint[] => {
    if (!list.length) return [];

    const earningsRows = Array.isArray(payload)
      ? payload.filter((item) => String(item?.type || '').toLowerCase() === 'earnings')
      : Array.isArray((payload as any)?.earnings)
        ? (payload as any).earnings
        : [];

    const newsRows = Array.isArray(payload)
      ? payload.filter((item) => String(item?.type || '').toLowerCase() !== 'earnings')
      : Array.isArray((payload as any)?.news)
        ? (payload as any).news
        : [];

    const normalizedEarnings = earningsRows
      .map((row: any) => {
        const time = toSec(row?.timestamp ?? row?.time ?? row?.date ?? row?.reportDate);
        if (!Number.isFinite(Number(time))) return null;
        const nearest = findNearestCandleTime(Number(time), list);
        if (!Number.isFinite(Number(nearest))) return null;
        return {
          type: 'earnings',
          time: Number(nearest),
          symbol: String(row?.symbol || symbol || '').trim().toUpperCase(),
          title: String(row?.title || 'Earnings'),
          payload: row,
        } as EventPoint;
      })
      .filter(Boolean) as EventPoint[];

    const normalizedNews = newsRows
      .filter((row: any) => {
        const headline = String(row?.headline || row?.title || '').trim();
        const newsScore = Number(row?.news_score ?? row?.newsScore ?? row?.score);
        const highImpact = Number(
          row?.keyword_high_impact_score
          ?? row?.score_breakdown?.keyword_high_impact_score
          ?? row?.scoreBreakdown?.keyword_high_impact_score,
        );
        const scoredHighImpact = (Number.isFinite(newsScore) && newsScore >= 0.7) || (Number.isFinite(highImpact) && highImpact >= 0.7);
        return scoredHighImpact || Boolean(headline);
      })
      .map((row: any) => {
        const time = toSec(row?.timestamp ?? row?.time ?? row?.publishedAt ?? row?.published_at ?? row?.publishedDate);
        if (!Number.isFinite(Number(time))) return null;
        const nearest = findNearestCandleTime(Number(time), list);
        if (!Number.isFinite(Number(nearest))) return null;
        const newsScore = Number(row?.news_score ?? row?.newsScore ?? row?.score);
        const highImpactScore = Number(
          row?.keyword_high_impact_score
          ?? row?.score_breakdown?.keyword_high_impact_score
          ?? row?.scoreBreakdown?.keyword_high_impact_score,
        );
        const major = (Number.isFinite(newsScore) && newsScore >= 0.7)
          || (Number.isFinite(highImpactScore) && highImpactScore >= 0.7);
        return {
          type: 'news',
          time: Number(nearest),
          epochSec: Number(nearest),
          major,
          symbol: String(row?.symbol || symbol || '').trim().toUpperCase(),
          title: String(row?.headline || row?.title || 'News'),
          url: row?.url || null,
          payload: row,
        } as EventPoint;
      })
      .filter(Boolean) as EventPoint[];

    const dedupe = new Map<string, EventPoint>();
    [...normalizedEarnings, ...normalizedNews].forEach((item) => {
      const key = `${item.type}|${item.time}|${item.title}`;
      if (!dedupe.has(key)) dedupe.set(key, item);
    });
    return Array.from(dedupe.values()).sort((a, b) => Number(a.time) - Number(b.time));
  };

  const formatMarkerHover = (point: EventPoint) => {
    if (point.type === 'earnings') {
      const payload = point.payload || {};
      const epsActual = payload?.eps_actual ?? payload?.epsActual ?? payload?.eps;
      const epsEstimate = payload?.eps_estimate ?? payload?.epsEstimate ?? payload?.epsEstimated;
      const revActual = payload?.rev_actual ?? payload?.revenueActual ?? payload?.revenue;
      const revEstimate = payload?.rev_estimate ?? payload?.revenueEstimate ?? payload?.revenueEstimated;
      const guidance = payload?.guidance_direction ?? payload?.guidanceDirection ?? payload?.guidance ?? 'N/A';
      const reportTime = payload?.report_time ?? payload?.reportTime ?? payload?.time ?? 'N/A';
      return {
        title: 'Earnings',
        lines: [
          `EPS: ${epsActual ?? '—'} vs ${epsEstimate ?? '—'}`,
          `Revenue: ${revActual ?? '—'} vs ${revEstimate ?? '—'}`,
          `Guidance: ${guidance ?? 'N/A'}`,
          `Report Time: ${reportTime ?? 'N/A'}`,
        ],
      };
    }

    const payload = point.payload || {};
    const source = payload?.source || 'Unknown';
    const ts = payload?.timestamp ?? payload?.time ?? payload?.publishedAt ?? payload?.published_at ?? payload?.publishedDate;
    const score = payload?.news_score ?? payload?.newsScore ?? payload?.score ?? '—';
    return {
      title: 'News',
      lines: [
        String(payload?.headline || payload?.title || point.title || 'Headline unavailable'),
        `Source: ${source}`,
        `Time: ${ts || 'N/A'}`,
        `Score: ${score}`,
      ],
    };
  };

  const hideTooltip = () => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    tooltip.style.display = 'none';
    tooltip.dataset.type = '';
    tooltip.dataset.symbol = '';
    tooltip.dataset.timestamp = '';
    tooltip.innerHTML = '';
  };

  const escapeHtml = (value: string) => String(value).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));

  const showTooltip = ({
    marker,
    x,
    y,
    container,
  }: {
    marker: EventPoint;
    x: number;
    y: number;
    container: HTMLDivElement;
  }) => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    const formatted = formatMarkerHover(marker);
    tooltip.innerHTML = `<div class="font-semibold text-slate-100">${escapeHtml(formatted.title)}</div>${formatted.lines
      .map((line) => `<div class="text-slate-200">${escapeHtml(String(line || ''))}</div>`)
      .join('')}`;

    tooltip.dataset.type = marker.type;
    tooltip.dataset.symbol = marker.symbol;
    tooltip.dataset.timestamp = String(marker.time);
    tooltip.style.display = 'block';

    const offsetX = 12;
    const offsetY = 12;
    const padding = 8;

    const tooltipWidth = tooltip.offsetWidth || 220;
    const tooltipHeight = tooltip.offsetHeight || 64;

    const maxX = Math.max(padding, container.clientWidth - tooltipWidth - padding);
    const maxY = Math.max(padding, container.clientHeight - tooltipHeight - padding);

    const left = Math.min(Math.max(padding, x + offsetX), maxX);
    const top = Math.min(Math.max(padding, y + offsetY), maxY);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const getOverlaySymbol = (): string | null => {
    if (marketOverlay === 'SPY') return 'SPY';
    if (marketOverlay === 'QQQ') return 'QQQ';
    if (marketOverlay === 'SECTOR') return sectorEtfSymbol || null;
    return null;
  };

  const toVisibleRangeHash = (from: number | null, to: number | null) => {
    const fromKey = Number.isFinite(Number(from)) ? Math.floor(Number(from)) : 'na';
    const toKey = Number.isFinite(Number(to)) ? Math.floor(Number(to)) : 'na';
    return `${fromKey}:${toKey}`;
  };

  const detectStaircase = (list: Candle[], rangeHash: string, baseIndexInFullSeries: number): StaircaseDetection | null => {
    if (!Array.isArray(list) || list.length < 4) return null;

    const buildBestSegment = (dir: StaircaseDirection) => {
      let bestStart = -1;
      let bestEnd = -1;
      let bestLegs = 0;

      let currentStart = -1;
      let currentLegs = 0;

      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1];
        const curr = list[i];

        const upStep = Number(curr.high) > Number(prev.high)
          && Number(curr.low) > Number(prev.low)
          && Number(curr.close) >= Number(prev.low);
        const downStep = Number(curr.high) < Number(prev.high)
          && Number(curr.low) < Number(prev.low)
          && Number(curr.close) <= Number(prev.high);
        const isStep = dir === 'UP' ? upStep : downStep;

        if (isStep) {
          if (currentStart < 0) {
            currentStart = i - 1;
            currentLegs = 1;
          } else {
            currentLegs += 1;
          }

          if (currentLegs > bestLegs) {
            bestLegs = currentLegs;
            bestStart = currentStart;
            bestEnd = i;
          }
        } else {
          currentStart = -1;
          currentLegs = 0;
        }
      }

      if (bestLegs < 3 || bestStart < 0 || bestEnd < 0) return null;
      return { dir, startIndex: bestStart, endIndex: bestEnd, legCount: bestLegs };
    };

    const up = buildBestSegment('UP');
    const down = buildBestSegment('DOWN');
    const picked = !up
      ? down
      : !down
        ? up
        : up.legCount >= down.legCount
          ? up
          : down;

    if (!picked) return null;

    const { dir, startIndex, endIndex, legCount } = picked;
    const segment = list.slice(startIndex, endIndex + 1);

    const indicatorValueAt = (values: unknown, candleIndex: number) => {
      const fullSeriesLen = sortedCandlesRef.current.length;
      if (!Array.isArray(values) || !values.length || !list.length || !fullSeriesLen) return null;
      const numeric = values.map((item) => Number(item));
      const offset = numeric.length - fullSeriesLen;
      const idx = baseIndexInFullSeries + candleIndex + offset;
      const value = numeric[idx];
      return Number.isFinite(value) ? value : null;
    };

    let volumeExpansions = 0;
    let volumeComparisons = 0;
    for (let i = startIndex + 1; i <= endIndex; i += 1) {
      const prevVol = Number(list[i - 1]?.volume || 0);
      const currVol = Number(list[i]?.volume || 0);
      if (!Number.isFinite(prevVol) || !Number.isFinite(currVol)) continue;
      volumeComparisons += 1;
      if (currVol >= prevVol) volumeExpansions += 1;
    }
    const volumeRatio = volumeComparisons > 0 ? (volumeExpansions / volumeComparisons) : 0;
    const volumeAlignment = volumeComparisons > 0 && volumeRatio >= 0.6;

    const emaStart = indicatorValueAt(indicatorsRef.current?.ema20, startIndex);
    const emaEnd = indicatorValueAt(indicatorsRef.current?.ema20, endIndex);
    const emaSlopePositive = Number.isFinite(Number(emaStart))
      && Number.isFinite(Number(emaEnd))
      && Number(emaEnd) > Number(emaStart);
    const emaAlignment = dir === 'UP' ? emaSlopePositive : Number.isFinite(Number(emaStart)) && Number.isFinite(Number(emaEnd)) && Number(emaEnd) < Number(emaStart);

    let vwapHits = 0;
    let vwapChecks = 0;
    for (let i = startIndex; i <= endIndex; i += 1) {
      const vwap = indicatorValueAt(indicatorsRef.current?.vwap, i);
      const close = Number(list[i]?.close);
      if (!Number.isFinite(Number(vwap)) || !Number.isFinite(close)) continue;
      vwapChecks += 1;
      if (dir === 'UP' ? close >= Number(vwap) : close <= Number(vwap)) {
        vwapHits += 1;
      }
    }
    const vwapAlignment = vwapChecks > 0 && (vwapHits / vwapChecks) >= 0.6;

    let strengthScore = 1;
    if (legCount >= 4) strengthScore += 1;
    if (legCount >= 6) strengthScore += 1;
    if (volumeAlignment) strengthScore += 1;
    if (emaAlignment) strengthScore += 1;
    if (vwapAlignment) strengthScore += 1;
    strengthScore = Math.min(5, Math.max(1, strengthScore));

    const highs = segment.map((candle) => Number(candle.high)).filter((value) => Number.isFinite(value));
    const lows = segment.map((candle) => Number(candle.low)).filter((value) => Number.isFinite(value));

    return {
      type: dir,
      startIndex,
      endIndex,
      legCount,
      strengthScore,
      volumeAlignment,
      vwapAlignment,
      emaSlopePositive,
      rangeHash,
      startTime: Number(list[startIndex]?.time),
      endTime: Number(list[endIndex]?.time),
      high: highs.length ? Math.max(...highs) : Number(list[endIndex]?.high),
      low: lows.length ? Math.min(...lows) : Number(list[startIndex]?.low),
    };
  };

  const drawSessionDividers = () => {
    const chart = chartRef.current;
    const canvas = sessionCanvasRef.current;
    const host = containerRef.current;
    if (!chart || !canvas || !host) return;

    const candlesForDraw = sortedCandlesRef.current;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    canvas.dataset.patternScanCount = String(patternScanCountRef.current);

    if (!candlesForDraw.length) {
      canvas.dataset.lineCount = '0';
      return;
    }

    const uniqueDays = new Set<string>();
    const dividerTimes: number[] = [];

    for (const candle of candlesForDraw) {
      const parts = toEtDateParts(Number(candle.time));
      const key = `${parts.year}-${parts.month}-${parts.day}`;
      if (uniqueDays.has(key)) continue;
      uniqueDays.add(key);

      const premkt = toEtWallTimeEpochSec(parts.year, parts.month, parts.day, 4, 0);
      const open = toEtWallTimeEpochSec(parts.year, parts.month, parts.day, 9, 30);
      const close = toEtWallTimeEpochSec(parts.year, parts.month, parts.day, 16, 0);
      if (Number.isFinite(premkt)) dividerTimes.push(premkt as number);
      if (Number.isFinite(open)) dividerTimes.push(open as number);
      if (Number.isFinite(close)) dividerTimes.push(close as number);
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(120,120,120,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    let lineCount = 0;
    for (const timestamp of dividerTimes) {
      const x = chart.timeScale().timeToCoordinate(timestamp as Time);
      if (!Number.isFinite(Number(x))) continue;
      const px = Number(x);
      if (px < 0 || px > width) continue;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, height);
      ctx.stroke();
      lineCount += 1;
    }

    ctx.restore();

    const pattern = patternMode ? patternResultRef.current : null;
    if (pattern && seriesRef.current.candle) {
      const xStart = chart.timeScale().timeToCoordinate(pattern.startTime as Time);
      const xEnd = chart.timeScale().timeToCoordinate(pattern.endTime as Time);
      const yHigh = seriesRef.current.candle.priceToCoordinate(pattern.high);
      const yLow = seriesRef.current.candle.priceToCoordinate(pattern.low);

      if ([xStart, xEnd, yHigh, yLow].every((value) => Number.isFinite(Number(value)))) {
        const left = Math.min(Number(xStart), Number(xEnd));
        const right = Math.max(Number(xStart), Number(xEnd));
        const top = Math.min(Number(yHigh), Number(yLow));
        const bottom = Math.max(Number(yHigh), Number(yLow));

        const centerX = (left + right) / 2;
        const centerY = (top + bottom) / 2;
        const radiusX = Math.max(20, ((right - left) / 2) + 12);
        const radiusY = Math.max(16, ((bottom - top) / 2) + 12);

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.strokeStyle = pattern.type === 'UP' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    canvas.dataset.lineCount = String(lineCount);
  };

  const updateDevOverlay = (expectedPaneCount: number) => {
    if (!IS_DEV) return;
    const overlay = containerRef.current?.querySelector('#chart-dev-overlay') as HTMLDivElement | null;
    if (!overlay) return;
    overlay.textContent = `ChartID: ${instanceIdRef.current} | Panes: ${expectedPaneCount}`;
  };

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    indicatorStateRef.current = indicatorState;
  }, [indicatorState]);

  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  useEffect(() => {
    indicatorsRef.current = indicators || {};
  }, [indicators]);

  const runPatternScan = () => {
    const chart = chartRef.current;
    if (!chart || !patternMode) return;

    const list = sortedCandlesRef.current;
    if (!Array.isArray(list) || list.length < 4) {
      patternResultRef.current = null;
      setPatternPopup((prev) => ({ ...prev, open: false, data: null }));
      drawSessionDividers();
      return;
    }

    const visible = chart.timeScale().getVisibleRange();
    const from = Number((visible as any)?.from);
    const to = Number((visible as any)?.to);
    const hasVisibleBounds = Number.isFinite(from) && Number.isFinite(to);

    const visibleCandles = hasVisibleBounds
      ? list.filter((candle) => Number(candle.time) >= from && Number(candle.time) <= to)
      : list;
    const visibleStartIndex = hasVisibleBounds
      ? list.findIndex((candle) => Number(candle.time) >= from)
      : 0;

    if (visibleCandles.length < 4) {
      patternResultRef.current = null;
      setPatternPopup((prev) => ({ ...prev, open: false, data: null }));
      drawSessionDividers();
      return;
    }

    const rangeHash = toVisibleRangeHash(hasVisibleBounds ? from : null, hasVisibleBounds ? to : null);
    const scanKey = `${symbol}|${timeframe}|${rangeHash}`;
    patternCurrentScanKeyRef.current = scanKey;

    let detected = patternScanCacheRef.current.get(scanKey) ?? null;
    if (!patternScanCacheRef.current.has(scanKey)) {
      detected = detectStaircase(visibleCandles, rangeHash, visibleStartIndex >= 0 ? visibleStartIndex : 0);
      patternScanCacheRef.current.set(scanKey, detected);
      patternScanCountRef.current += 1;
    }

    patternResultRef.current = detected;
    if (containerRef.current) {
      containerRef.current.dataset.patternResult = detected ? JSON.stringify({
        type: detected.type,
        startIndex: detected.startIndex,
        endIndex: detected.endIndex,
        legCount: detected.legCount,
        strengthScore: detected.strengthScore,
      }) : '';
    }
    drawSessionDividers();

    if (!detected) {
      setPatternPopup((prev) => ({ ...prev, open: false, data: null }));
      return;
    }

    if (patternDismissedScanKeyRef.current === scanKey) {
      setPatternPopup((prev) => ({ ...prev, data: detected }));
      return;
    }

    const host = containerRef.current;
    const popupWidth = 300;
    const popupHeight = 150;
    const centerX = host ? Math.max(8, (host.clientWidth - popupWidth) / 2) : 24;
    const centerY = host ? Math.max(8, (host.clientHeight - popupHeight) / 2) : 24;

    setPatternPopup({
      open: true,
      x: centerX,
      y: centerY,
      data: detected,
    });
  };

  useEffect(() => {
    if (patternMode) return;
    patternResultRef.current = null;
    patternCurrentScanKeyRef.current = '';
    patternDismissedScanKeyRef.current = '';
    setPatternPopup((prev) => ({ ...prev, open: false, data: null }));
    drawSessionDividers();
  }, [patternMode]);

  const seriesRef = useRef<{
    candle: ISeriesApi<'Candlestick'> | null;
    volume: ISeriesApi<'Histogram'> | null;
    vwap: ISeriesApi<'Line'> | null;
    rsi: ISeriesApi<'Line'> | null;
    macd: ISeriesApi<'Line'> | null;
    macdSignal: ISeriesApi<'Line'> | null;
    macdHistogram: ISeriesApi<'Histogram'> | null;
    orHigh: ISeriesApi<'Line'> | null;
    orLow: ISeriesApi<'Line'> | null;
  }>({
    candle: null,
    volume: null,
    vwap: null,
    rsi: null,
    macd: null,
    macdSignal: null,
    macdHistogram: null,
    orHigh: null,
    orLow: null,
  });

  const applyPaneHeights = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const panes = chart.panes();
    if (!Array.isArray(panes) || panes.length === 0) return;

    while (panes.length > 1) {
      chart.removePane(panes.length - 1);
    }

    panes[0]?.setStretchFactor(1);
  };

  const pruneEmptyPanes = () => {
    const chart = chartRef.current;
    if (!chart) return false;
    const expectedCount = 1;
    const beforeCount = chart.panes().length;
    while (chart.panes().length > expectedCount) {
      chart.removePane(chart.panes().length - 1);
    }
    chart.panes().forEach((pane) => pane.setPreserveEmptyPane(false));
    const pruned = chart.panes().length < beforeCount;

    if (pruned) {
      updateDevOverlay(expectedCount);
    }

    if (IS_DEV && chart.panes().length > expectedCount) {
      console.warn('[ChartEngine] Pane count exceeds expected profile count', {
        expectedCount,
        actualCount: chart.panes().length,
        timeframe,
      });
    }

    return pruned;
  };

  const removeSeries = (series: ISeriesApi<any> | null) => {
    const chart = chartRef.current;
    if (!chart || !series) return;
    try {
      chart.removeSeries(series);
    } catch (_error) {
    }
  };

  const statsLabel = useMemo(() => {
    const latestAtr = Array.isArray(safeIndicators?.atr14) && safeIndicators.atr14.length
      ? safeIndicators.atr14[safeIndicators.atr14.length - 1]
      : null;
    const atrLabel = Number.isFinite(latestAtr) ? `ATR ${Number(latestAtr).toFixed(2)}` : 'ATR —';
    return `${atrLabel}`;
  }, [safeIndicators]);

  const ohlcSummary = useMemo(() => {
    const data = ohlcHeader;
    if (!data) {
      return {
        open: '—',
        high: '—',
        low: '—',
        close: '—',
        volume: '—',
        change: '—',
        changePct: '—',
      };
    }

    const toPrice = (value: number) => Number(value).toFixed(2);
    return {
      open: toPrice(data.open),
      high: toPrice(data.high),
      low: toPrice(data.low),
      close: toPrice(data.close),
      volume: Number(data.volume).toLocaleString(),
      change: `${data.change >= 0 ? '+' : ''}${toPrice(data.change)}`,
      changePct: `${data.changePct >= 0 ? '+' : ''}${Number(data.changePct).toFixed(2)}%`,
    };
  }, [ohlcHeader]);

  // Lifecycle rule: create chart/series exactly once per mount; never create them in render.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    if (chartRef.current) return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.error('[FATAL] Chart container has zero dimensions', rect);
      console.warn('Chart aborted: zero dimensions');
      return;
    }

    const width = rect.width;
    const height = rect.height;

    if (IS_DEV && chartRef.current && !devWarnedRemountRef.current) {
      devWarnedRemountRef.current = true;
      console.warn('[ChartEngine] Chart recreation attempt detected', new Error().stack);
    }

    const chart = createChart(el, {
        width,
        height,
        layout: {
          background: { type: 'solid' as any, color: '#0b1220' },
          textColor: '#cbd5e1',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontSize: 12,
          panes: {
            separatorColor: '#0b1220',
            separatorHoverColor: '#0b1220',
            enableResize: false,
          } as any,
        },
        grid: {
          vertLines: { color: 'rgba(148,163,184,0.08)' },
          horzLines: { color: 'rgba(148,163,184,0.08)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(148,163,184,0.25)',
          scaleMargins: { top: 0.04, bottom: 0.06 },
        },
        timeScale: {
          borderColor: 'rgba(148,163,184,0.25)',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 12,
        },
        crosshair: {
          mode: 0,
          vertLine: { color: '#64748b', width: 1, style: 2, labelVisible: false },
          horzLine: { color: '#64748b', width: 1, style: 2 },
        },
        handleScale: true,
        handleScroll: true,
      });
    const candle = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        priceLineVisible: true,
      });

      const orHigh = chart.addSeries(LineSeries, { color: '#facc15', lineWidth: 1, lineStyle: 2 });
      const orLow = chart.addSeries(LineSeries, { color: '#facc15', lineWidth: 1, lineStyle: 2 });

      seriesRef.current = {
        candle,
        volume: null,
        vwap: null,
        rsi: null,
        macd: null,
        macdSignal: null,
        macdHistogram: null,
        orHigh,
        orLow,
      };

    eventMarkerApiRef.current = null;

    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        if (!containerRef.current || !chartRef.current) return;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        pruneEmptyPanes();
        applyPaneHeights();
        updateOrBoxElement(
          orBoxRef.current,
          chartRef.current,
          seriesRef.current.candle,
          levelsRef.current,
          profileRef.current.showOpeningRangeBox,
        );
        drawSessionDividers();
      });
    }

    resizeObserverRef.current.observe(el);

    const visibleRangeCallback = () => {
      updateOrBoxElement(
        orBoxRef.current,
        chartRef.current,
        seriesRef.current.candle,
        levelsRef.current,
        profileRef.current.showOpeningRangeBox,
      );
      drawSessionDividers();
    };
    visibleRangeCallbackRef.current = visibleRangeCallback;
    chart.timeScale().subscribeVisibleTimeRangeChange(visibleRangeCallback);

    const crosshairCallback = (param: MouseEventParams<Time>) => {
        const list = sortedCandlesRef.current;
        const container = containerRef.current;
        if (!list.length) return;

        let targetIndex = -1;
        const eventTime = Number(param?.time);
        if (Number.isFinite(eventTime)) {
          targetIndex = list.findIndex((candle) => Number(candle.time) === eventTime);
        }
        if (targetIndex < 0) {
          targetIndex = list.length - 1;
        }

        const target = list[targetIndex] || null;

        const next = toHeaderFromCandle(target, targetIndex, list);
        if (!next) return;
        const prev = headerRef.current;
        if (
          prev
          && prev.open === next.open
          && prev.high === next.high
          && prev.low === next.low
          && prev.close === next.close
          && prev.volume === next.volume
          && prev.change === next.change
          && prev.changePct === next.changePct
        ) {
          return;
        }
        headerRef.current = next;
        setOhlcHeader(next);

        const seriesPrice = (param as any)?.seriesPrices?.get(seriesRef.current.candle as any)
          ?? (param as any)?.seriesData?.get(seriesRef.current.candle as any);
        if (seriesPrice == null || !param?.point || !container) {
          hideTooltip();
          if (suppressNextCrosshairEmitRef.current) {
            suppressNextCrosshairEmitRef.current = false;
          }
          return;
        }

        const syncTime = Number(param?.time);

        if (suppressNextCrosshairEmitRef.current) {
          suppressNextCrosshairEmitRef.current = false;
        } else {
          const nextChartId = String(chartIdRef.current || '').trim();
          if (crosshairSyncEnabledRef.current && nextChartId && Number.isFinite(syncTime)) {
            if (lastEmittedSyncTimeRef.current !== syncTime) {
              lastEmittedSyncTimeRef.current = syncTime;
              chartSyncBus.emit(syncTime, nextChartId);
            }
          }
        }

        const hoveredTime = Number(param?.time);
        const markerMap = markerByTimeRef.current;
        const markerHits = Number.isFinite(hoveredTime) ? (markerMap.get(hoveredTime) || []) : [];
        const marker = markerHits.find((item) => item.type === 'earnings') || markerHits[0] || null;
        if (!marker) {
          hideTooltip();
          return;
        }

        showTooltip({
          marker,
          x: Number(param.point.x || 0),
          y: Number(param.point.y || 0),
          container,
        });
    };
    crosshairCallbackRef.current = crosshairCallback;
    chart.subscribeCrosshairMove(crosshairCallback);

    chartRef.current = chart;

    if (!tooltipRef.current && containerRef.current) {
      const tooltip = document.createElement('div');
      tooltip.className = 'pointer-events-none absolute z-[3] max-w-[360px] rounded-md border border-white/15 bg-black/80 px-2 py-1 text-[11px] text-slate-100';
      tooltip.style.display = 'none';
      tooltip.dataset.role = 'event-tooltip';
      tooltip.dataset.type = '';
      tooltip.dataset.symbol = '';
      tooltip.dataset.timestamp = '';
      containerRef.current.appendChild(tooltip);
      tooltipRef.current = tooltip;
    }

    if (IS_DEV) {
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '6px';
      overlay.style.right = '10px';
      overlay.style.fontSize = '11px';
      overlay.style.fontFamily = 'monospace';
      overlay.style.opacity = '0.6';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';
      overlay.id = 'chart-dev-overlay';
      containerRef.current?.appendChild(overlay);

      const expectedPaneCount = 1;
      updateDevOverlay(expectedPaneCount);
    }

    return () => {
      const chart = chartRef.current;

      if (IS_DEV) {
        const overlay = containerRef.current?.querySelector('#chart-dev-overlay');
        overlay?.remove();
      }
      if (chart && visibleRangeCallbackRef.current) {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(visibleRangeCallbackRef.current);
        visibleRangeCallbackRef.current = null;
      }
      if (chart && crosshairCallbackRef.current) {
        chart.unsubscribeCrosshairMove(crosshairCallbackRef.current);
        crosshairCallbackRef.current = null;
      }
      if (chart && patternVisibleRangeCallbackRef.current) {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(patternVisibleRangeCallbackRef.current);
        patternVisibleRangeCallbackRef.current = null;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      levelLinesRef.current.forEach(({ series, line }) => {
        try {
          series.removePriceLine(line);
        } catch (_error) {
        }
      });
      levelLinesRef.current = [];
      hideTooltip();
      tooltipRef.current?.remove();
      tooltipRef.current = null;
      removeSeries(overlaySeriesRef.current);
      overlaySeriesRef.current = null;
      chart?.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartId) return;

    const handleSyncEvent = (event: { time: number | null; sourceId: string }) => {
      if (!crosshairSyncEnabled) return;
      if (!event || event.sourceId === chartId) return;

      const chart = chartRef.current as any;
      const candleSeries = seriesRef.current.candle as any;
      if (!chart || !candleSeries) return;

      const nextTime = Number(event.time);
      if (!Number.isFinite(nextTime)) {
        if (typeof chart.clearCrosshairPosition === 'function') {
          chart.clearCrosshairPosition();
        }
        return;
      }

      const candles = sortedCandlesRef.current;
      if (!candles.length) {
        return;
      }

      let matchingCandleIndex = 0;
      let matchingCandle = candles[matchingCandleIndex];
      let nearestDistance = Math.abs(Number(matchingCandle.time) - nextTime);

      for (let index = 1; index < candles.length; index += 1) {
        const candidate = candles[index];
        const distance = Math.abs(Number(candidate.time) - nextTime);
        if (distance < nearestDistance) {
          matchingCandleIndex = index;
          matchingCandle = candidate;
          nearestDistance = distance;
        }
      }

      const appliedTime = Number(matchingCandle.time);
      if (!Number.isFinite(appliedTime) || !Number.isFinite(Number(matchingCandle.close))) {
        return;
      }

      if (lastAppliedSyncTimeRef.current === appliedTime) {
        return;
      }

      suppressNextCrosshairEmitRef.current = true;
      lastAppliedSyncTimeRef.current = appliedTime;

      if (typeof chart.setCrosshairPosition === 'function') {
        chart.setCrosshairPosition(Number(matchingCandle.close), appliedTime, candleSeries);
      }

      const nextHeader = toHeaderFromCandle(matchingCandle, matchingCandleIndex, candles);
      if (nextHeader) {
        const prev = headerRef.current;
        if (
          !prev
          || prev.open !== nextHeader.open
          || prev.high !== nextHeader.high
          || prev.low !== nextHeader.low
          || prev.close !== nextHeader.close
          || prev.volume !== nextHeader.volume
          || prev.change !== nextHeader.change
          || prev.changePct !== nextHeader.changePct
        ) {
          headerRef.current = nextHeader;
          setOhlcHeader(nextHeader);
        }
      }
    };

    chartSyncBus.subscribe(handleSyncEvent);

    return () => {
      chartSyncBus.unsubscribe(handleSyncEvent);
    };
  }, [chartId, crosshairSyncEnabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !patternMode) return;

    const callback = () => {
      runPatternScan();
    };

    patternVisibleRangeCallbackRef.current = callback;
    chart.timeScale().subscribeVisibleTimeRangeChange(callback);
    runPatternScan();

    return () => {
      if (patternVisibleRangeCallbackRef.current) {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(patternVisibleRangeCallbackRef.current);
        patternVisibleRangeCallbackRef.current = null;
      }
    };
  }, [patternMode, symbol, timeframe]);

  useEffect(() => {
    if (!patternDragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const host = containerRef.current;
      const popupEl = patternPopupRef.current;
      if (!host || !popupEl) return;

      const hostRect = host.getBoundingClientRect();
      const popupRect = popupEl.getBoundingClientRect();
      const nextX = event.clientX - hostRect.left - patternDragOffsetRef.current.x;
      const nextY = event.clientY - hostRect.top - patternDragOffsetRef.current.y;

      const clampedX = Math.min(Math.max(8, nextX), Math.max(8, host.clientWidth - popupRect.width - 8));
      const clampedY = Math.min(Math.max(8, nextY), Math.max(8, host.clientHeight - popupRect.height - 8));

      setPatternPopup((prev) => ({ ...prev, x: clampedX, y: clampedY }));
    };

    const onMouseUp = () => {
      setPatternDragging(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [patternDragging]);

  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart) return;
    const isDailyTimeframe = normalizeTimeframe(String(timeframe || '')) === '1D';

    if (indicatorState.volume && !s.volume) {
      s.volume = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      s.volume.priceScale().applyOptions({
        borderColor: 'rgba(148,163,184,0.2)',
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      eventMarkerApiRef.current = createSeriesMarkers(s.volume);
    }

    if (!indicatorState.volume) {
      eventMarkerApiRef.current = null;
      removeSeries(s.volume);
      s.volume = null;
    }

    const emaEnabledByPeriod: Record<EmaPeriod, boolean> = {
      9: Boolean(indicatorState.ema9),
      20: Boolean(indicatorState.ema20),
      50: Boolean(indicatorState.ema50),
      200: Boolean(indicatorState.ema200),
    };

    emaPeriods.forEach((period) => {
      const currentSeries = emaSeriesRefs.current[period];
      const enabled = emaEnabledByPeriod[period];
      if (enabled && !currentSeries) {
        const nextSeries = chart.addSeries(LineSeries, {
          priceScaleId: 'right',
          color: period === 9 ? '#f59e0b' : period === 20 ? '#38bdf8' : period === 50 ? '#22d3ee' : '#e2e8f0',
          lineWidth: 2,
          lastValueVisible: period === 20 || period === 200,
          priceLineVisible: false,
          title: `EMA ${period}`,
          crosshairMarkerVisible: false,
        });
        emaSeriesRefs.current[period] = nextSeries;
      }
      if (!enabled && currentSeries) {
        removeSeries(currentSeries);
        emaSeriesRefs.current[period] = null;
      }
    });

    if (indicatorState.vwap && !isDailyTimeframe && !s.vwap) {
      s.vwap = chart.addSeries(LineSeries, {
        priceScaleId: 'right',
        color: '#a78bfa',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        title: 'VWAP',
        crosshairMarkerVisible: false,
      });
    }

    if (!indicatorState.vwap || isDailyTimeframe) {
      removeSeries(s.vwap);
      s.vwap = null;
    }

    removeSeries(s.rsi);
    s.rsi = null;

    removeSeries(s.macd);
    removeSeries(s.macdSignal);
    removeSeries(s.macdHistogram);
    s.macd = null;
    s.macdSignal = null;
    s.macdHistogram = null;
    macdPaneIndexRef.current = null;

    s.candle?.priceScale().applyOptions({
      scaleMargins: indicatorState.volume
        ? { top: 0.04, bottom: 0.22 }
        : { top: 0.04, bottom: 0.06 },
    });

    pruneEmptyPanes();
    applyPaneHeights();

    const expectedPaneCount = 1;
    updateDevOverlay(expectedPaneCount);
  }, [indicatorState, safeCandles, timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const overlaySymbol = getOverlaySymbol();
    if (!overlaySymbol || marketOverlay === 'none') {
      removeSeries(overlaySeriesRef.current);
      overlaySeriesRef.current = null;
      return;
    }

    const overlayColor = marketOverlay === 'SPY'
      ? 'rgba(154,160,166,0.6)'
      : marketOverlay === 'QQQ'
        ? 'rgba(77,171,247,0.6)'
        : 'rgba(177,151,252,0.6)';

    if (!overlaySeriesRef.current) {
      overlaySeriesRef.current = chart.addSeries(LineSeries, {
        color: overlayColor,
        lineWidth: 1.5,
        lineStyle: 0,
        lineType: 0,
        lineVisible: true,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        priceScaleId: 'overlay',
      } as any);
      overlaySeriesRef.current.priceScale().applyOptions({
        visible: false,
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      } as any);
    } else {
      overlaySeriesRef.current.applyOptions({ color: overlayColor });
    }

    let active = true;
    const fetchOverlayCandles = async (): Promise<Candle[]> => {
      const cacheKey = `${overlaySymbol}|${timeframe}`;
      const cached = overlayCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const pending = overlayInflightRef.current.get(cacheKey);
      if (pending) return pending;

      const task = (async () => {
        const interval = toInterval(timeframe);
        const response = await authFetch(`/api/v5/chart?symbol=${encodeURIComponent(overlaySymbol)}&interval=${encodeURIComponent(interval)}`);
        if (!response.ok) throw new Error(`Overlay fetch failed (${response.status})`);
        const payload = await response.json();
        const rows = Array.isArray(payload?.candles) ? payload.candles : [];
        const normalized = rows
          .map((row: any) => ({
            time: Number(row?.time),
            open: Number(row?.open),
            high: Number(row?.high),
            low: Number(row?.low),
            close: Number(row?.close),
            volume: Number(row?.volume || 0),
          }))
          .filter((row: Candle) => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite))
          .sort((a: Candle, b: Candle) => a.time - b.time);
        overlayCacheRef.current.set(cacheKey, normalized);
        return normalized;
      })();

      overlayInflightRef.current.set(cacheKey, task);
      try {
        const result = await task;
        return result;
      } finally {
        overlayInflightRef.current.delete(cacheKey);
      }
    };

    const run = async () => {
      try {
        const overlayCandles = await fetchOverlayCandles();
        if (!active || !overlaySeriesRef.current) return;
        if (!overlayCandles.length) {
          overlaySeriesRef.current.setData([]);
          return;
        }

        const visibleRange = chart.timeScale().getVisibleRange();
        const visibleStart = Number((visibleRange as any)?.from);

        const baseCandle = Number.isFinite(visibleStart)
          ? overlayCandles.find((candle) => Number(candle.time) >= visibleStart) || overlayCandles[0]
          : overlayCandles[0];

        const base = Number(baseCandle?.close);
        if (!Number.isFinite(base) || base === 0) {
          overlaySeriesRef.current.setData([]);
          return;
        }

        const normalizedSeries = overlayCandles.map((candle) => ({
          time: candle.time as Time,
          value: ((Number(candle.close) / base) - 1) * 100,
        }));

        overlaySeriesRef.current.setData(normalizedSeries as any);
      } catch (_error) {
        if (overlaySeriesRef.current) {
          overlaySeriesRef.current.setData([]);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [marketOverlay, sectorEtfSymbol, timeframe, symbol]);

  // Lifecycle rule: update series data only; no chart recreation when symbol/timeframe changes.
  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s.candle) return;
    hideTooltip();

    const previousCandles = previousCandlesRef.current;
    const contextChanged = previousSymbolRef.current !== symbol || previousTimeframeRef.current !== timeframe;

    if (contextChanged) {
      s.candle.setData([]);
      s.volume?.setData([]);
      emaPeriods.forEach((period) => {
        emaSeriesRefs.current[period]?.setData([]);
      });
      s.vwap?.setData([]);
      s.rsi?.setData([]);
      s.macd?.setData([]);
      s.macdSignal?.setData([]);
      s.macdHistogram?.setData([]);
      s.orHigh?.setData([]);
      s.orLow?.setData([]);
    }

    if (!safeCandles.length) return;

    const sorted = [...safeCandles].sort((a, b) => a.time - b.time);
    sortedCandlesRef.current = sorted;

    const latestIndex = sorted.length ? sorted.length - 1 : -1;
    const latestHeader = toHeaderFromCandle(
      latestIndex >= 0 ? sorted[latestIndex] : null,
      latestIndex,
      sorted,
    );
    if (latestHeader) {
      headerRef.current = latestHeader;
      setOhlcHeader(latestHeader);
    }
    const sameContext = previousSymbolRef.current === symbol && previousTimeframeRef.current === timeframe;
    const replacedLast = sameContext
      && previousCandles.length === sorted.length
      && sorted.length > 0
      && previousCandles.length > 0
      && previousCandles[previousCandles.length - 1].time === sorted[sorted.length - 1].time;
    const appendedOne = sameContext
      && previousCandles.length + 1 === sorted.length
      && previousCandles.length > 0
      && sorted.length > 1
      && previousCandles[previousCandles.length - 1].time === sorted[sorted.length - 2].time;
    const incrementalCandleUpdate = Number.isFinite(Number(effectiveLastUpdateTime)) && (replacedLast || appendedOne);

    const toSeriesFromValues = (values?: number[]) => {
      if (!Array.isArray(values) || !values.length) return [];
      const sanitized = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      if (!sanitized.length) return [];
      const len = Math.min(sanitized.length, sorted.length);
      const candleOffset = sorted.length - len;
      const valueOffset = sanitized.length - len;
      return sanitized.slice(valueOffset).map((value, index) => ({
        time: sorted[candleOffset + index].time as Time,
        value,
      }));
    };

    const mapCandle = (c: Candle) => ({
      time: c.time as Time,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    });

    const candleData = sorted.map(mapCandle);

    const markerApi = eventMarkerApiRef.current;
    let normalisedMarkers: any[] = [];
    if (markerApi) {
      const normalized = parseEvents(safeEvents as EventPayload, sorted);
      const alignedEvents = normalized.map((event) => {
        const alignedTime = alignToNearestCandle(Number(event.time), sorted);
        return {
          ...event,
          epochSec: alignedTime,
          time: alignedTime,
        };
      });
      const safeMarkers = alignedEvents.filter((marker) => marker?.time != null);
      const byTime = new Map<number, EventPoint[]>();
      safeMarkers.forEach((event) => {
        const key = Number(event.epochSec ?? event.time);
        if (!Number.isFinite(key)) return;
        const listAtTime = byTime.get(key) || [];
        listAtTime.push(event);
        byTime.set(key, listAtTime);
      });
      markerByTimeRef.current = byTime;

      const groupedMarkers = buildEventMarkers(safeMarkers).filter(Boolean);
      const isBusinessDay = typeof (candleData?.[0] as any)?.time === 'object';
      normalisedMarkers = groupedMarkers.map((m: any) => {
        if (!isBusinessDay) return m;
        const epochSec = Number(m?.epochSec ?? m?.time);
        if (!Number.isFinite(epochSec)) return m;
        const date = new Date(epochSec * 1000);
        return {
          ...m,
          time: {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
          },
        };
      });
    } else {
      markerByTimeRef.current = new Map();
    }

    if (incrementalCandleUpdate) {
      s.candle.update(mapCandle(sorted[sorted.length - 1]));
    } else {
      s.candle.setData(candleData);
      markerApi?.setMarkers(normalisedMarkers);
      s.candle.applyOptions({ priceScaleId: 'right' });
    }

    if (s.volume) {
      const mapVolume = (c: Candle) => ({
        time: c.time as Time,
        value: Number(c.volume || 0),
        color: Number(c.close) >= Number(c.open) ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)',
      });

      if (incrementalCandleUpdate) {
        s.volume.update(mapVolume(sorted[sorted.length - 1]));
      } else {
        s.volume.setData(sorted.map(mapVolume));
      }
      s.volume.applyOptions({ visible: indicatorState.volume });
    }

    const emaDataByPeriod: Record<EmaPeriod, Array<{ time: Time; value: number }>> = {
      9: buildEmaSeries(sorted, 9),
      20: buildEmaSeries(sorted, 20),
      50: buildEmaSeries(sorted, 50),
      200: buildEmaSeries(sorted, 200),
    };
    emaPeriods.forEach((period) => {
      const series = emaSeriesRefs.current[period];
      if (!series) return;
      series.setData(emaDataByPeriod[period]);
    });

    const isDailyTimeframe = normalizeTimeframe(String(timeframe || '')) === '1D';
    if (s.vwap) {
      const vwapData = isDailyTimeframe ? [] : buildVwapSeries(sorted, timeframe);
      s.vwap.setData(vwapData);
    }

    if (s.rsi) s.rsi.setData(toSeriesFromValues(safeIndicators.rsi14));

    const macdSeries = buildMacdSeries(sorted);
    if (s.macd) s.macd.setData(macdSeries.macd);
    if (s.macdSignal) s.macdSignal.setData(macdSeries.signal);
    if (s.macdHistogram) s.macdHistogram.setData(macdSeries.histogram);

    const emaVisibleByPeriod: Record<EmaPeriod, boolean> = {
      9: Boolean(indicatorState.ema9),
      20: Boolean(indicatorState.ema20),
      50: Boolean(indicatorState.ema50),
      200: Boolean(indicatorState.ema200),
    };
    emaPeriods.forEach((period) => {
      emaSeriesRefs.current[period]?.applyOptions({ visible: emaVisibleByPeriod[period] });
    });
    s.vwap?.applyOptions({ visible: indicatorState.vwap && !isDailyTimeframe });
    if (s.rsi) s.rsi.applyOptions({ visible: indicatorState.rsi });
    if (s.macd) s.macd.applyOptions({ visible: indicatorState.macd });
    if (s.macdSignal) s.macdSignal.applyOptions({ visible: indicatorState.macd });
    if (s.macdHistogram) s.macdHistogram.applyOptions({ visible: indicatorState.macd });

    if (profile.showOpeningRange && Number.isFinite(safeLevels.orHigh) && Number.isFinite(safeLevels.orLow)) {
      const lineDataHigh = sorted.map((c) => ({ time: c.time as Time, value: Number(safeLevels.orHigh) }));
      const lineDataLow = sorted.map((c) => ({ time: c.time as Time, value: Number(safeLevels.orLow) }));
      s.orHigh?.setData(lineDataHigh);
      s.orLow?.setData(lineDataLow);
      s.orHigh?.applyOptions({ visible: true });
      s.orLow?.applyOptions({ visible: true });
    } else {
      s.orHigh?.applyOptions({ visible: false });
      s.orLow?.applyOptions({ visible: false });
    }

    levelLinesRef.current.forEach(({ series, line }) => {
      try {
        series.removePriceLine(line);
      } catch (_error) {
      }
    });
    levelLinesRef.current = [];

    const levelDefs = buildLevelDefinitions(safeLevels, profile.showPDHPDL);
    levelDefs.forEach((line) => {
      const created = s.candle?.createPriceLine({
        price: line.price,
        title: line.title,
        color: line.color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
      if (created && s.candle) levelLinesRef.current.push({ series: s.candle, line: created });
    });

    updateOrBoxElement(orBoxRef.current, chartRef.current, s.candle, safeLevels, profile.showOpeningRangeBox);

    pruneEmptyPanes();
    applyPaneHeights();

    const datasetKey = `${symbol}|${timeframe}|${sorted[0]?.time || 0}`;
    const shouldFit = !incrementalCandleUpdate
      && (
        previousCandles.length === 0
        || previousSymbolRef.current !== symbol
        || previousTimeframeRef.current !== timeframe
      );
    if (shouldFit && datasetKey !== lastDatasetKeyRef.current) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().resetTimeScale();
      lastDatasetKeyRef.current = datasetKey;
      chart.timeScale().fitContent();
    }

    drawSessionDividers();

    if (patternMode && contextChanged) {
      runPatternScan();
    }

    previousCandlesRef.current = sorted;
    previousSymbolRef.current = symbol;
    previousTimeframeRef.current = timeframe;
  }, [symbol, timeframe, safeCandles, effectiveLastUpdateTime, safeIndicators, safeLevels, safeEvents, profile, indicatorState]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candle) return;

    drawingLinesRef.current.forEach(({ line }) => {
      try {
        s.candle?.removePriceLine(line);
      } catch (_error) {
      }
    });
    drawingLinesRef.current = [];

    const isDark = theme === 'dark';
    const color = isDark ? '#f59e0b' : '#b45309';
    drawingRowsRef.current.forEach((row) => {
      const created = s.candle?.createPriceLine({
        price: Number(row.price),
        title: row.label || 'Line',
        color,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
      });
      if (created) drawingLinesRef.current.push({ id: row.id, line: created });
    });
  }, [drawings, theme, symbol, timeframe]);

  useEffect(() => {
    hideTooltip();
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!chartRef.current) return;

    const isDark = theme === 'dark';
    const series = seriesRef.current;

    chartRef.current.applyOptions({
      layout: {
        background: {
          type: 'solid' as any,
          color: isDark ? '#0f172a' : '#ffffff',
        },
        textColor: isDark ? '#cbd5e1' : '#1e293b',
      },
      grid: {
        vertLines: {
          color: isDark ? '#1e293b' : '#e5e7eb',
        },
        horzLines: {
          color: isDark ? '#1e293b' : '#e5e7eb',
        },
      },
      crosshair: {
        vertLine: { color: isDark ? '#334155' : '#9ca3af', width: 1, style: 2, labelVisible: false },
        horzLine: { color: isDark ? '#334155' : '#9ca3af', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: isDark ? '#1e293b' : '#e5e7eb',
      },
      timeScale: {
        borderColor: isDark ? '#1e293b' : '#e5e7eb',
      },
    });

    series.candle?.applyOptions({
      upColor: isDark ? '#22c55e' : '#16a34a',
      downColor: isDark ? '#ef4444' : '#dc2626',
      borderVisible: false,
      wickUpColor: isDark ? '#22c55e' : '#16a34a',
      wickDownColor: isDark ? '#ef4444' : '#dc2626',
    });

    if (series.volume && sortedCandlesRef.current.length) {
      series.volume.setData(sortedCandlesRef.current.map((c) => ({
        time: c.time as Time,
        value: Number(c.volume || 0),
        color: Number(c.close) >= Number(c.open)
          ? (isDark ? 'rgba(34,197,94,0.45)' : 'rgba(22,163,74,0.45)')
          : (isDark ? 'rgba(239,68,68,0.45)' : 'rgba(220,38,38,0.45)'),
      })));
    }

    emaSeriesRefs.current[9]?.applyOptions({ color: isDark ? '#f59e0b' : '#d97706' });
    emaSeriesRefs.current[20]?.applyOptions({ color: isDark ? '#38bdf8' : '#0284c7' });
    emaSeriesRefs.current[50]?.applyOptions({ color: isDark ? '#22d3ee' : '#0891b2' });
    emaSeriesRefs.current[200]?.applyOptions({ color: isDark ? '#e2e8f0' : '#475569' });
    series.vwap?.applyOptions({ color: isDark ? '#a78bfa' : '#7c3aed' });
    series.rsi?.applyOptions({ color: isDark ? '#818cf8' : '#4f46e5' });
    series.macd?.applyOptions({ color: isDark ? '#f472b6' : '#db2777' });
    series.macdSignal?.applyOptions({ color: isDark ? '#94a3b8' : '#64748b' });
    series.macdHistogram?.applyOptions({
      base: 0,
      color: isDark ? 'rgba(34,197,94,0.55)' : 'rgba(22,163,74,0.55)',
    } as any);
  }, [theme]);

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff' }}>
      <canvas
        ref={sessionCanvasRef}
        className="pointer-events-none absolute inset-0 z-[1]"
        aria-hidden="true"
      />
      <div ref={containerRef} className="relative w-full h-full" />
      <div
        ref={orBoxRef}
        className="pointer-events-none absolute border border-amber-300/50 bg-amber-300/10"
        style={{ display: 'none' }}
      />
      <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/35 px-2 py-1 text-[11px] text-slate-200">
        {statsLabel}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/35 px-2 py-1 text-[11px] text-slate-200">
        <div className="font-semibold text-slate-100">{symbol} — N/A</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2">
          <span>O: {ohlcSummary.open}</span>
          <span>H: {ohlcSummary.high}</span>
          <span>L: {ohlcSummary.low}</span>
          <span>C: {ohlcSummary.close}</span>
          <span>Vol: {ohlcSummary.volume}</span>
          <span>Chg: {ohlcSummary.change} ({ohlcSummary.changePct})</span>
        </div>
        <div className="mt-0.5 text-slate-300">{profile.label}</div>
      </div>
      {effectiveLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b1220]/25 text-sm text-slate-200">Loading chart…</div>
      )}
      {effectiveError && (
        <div className="absolute bottom-3 left-3 rounded-md border border-red-500/40 bg-red-500/15 px-3 py-1 text-xs text-red-200">
          {effectiveError}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 z-[4]">
        {patternMode && patternPopup.open && patternPopup.data && (
          <div
            ref={patternPopupRef}
            data-role="pattern-popup"
            className="pointer-events-auto absolute w-[300px] rounded-md border border-white/20 bg-[#0f172a]/95 shadow-lg"
            style={{ left: patternPopup.x, top: patternPopup.y }}
          >
            <div
              className="flex cursor-move items-center justify-between border-b border-white/10 px-3 py-2 text-xs font-semibold text-slate-100"
              onMouseDown={(event) => {
                const popupEl = patternPopupRef.current;
                if (!popupEl) return;
                const rect = popupEl.getBoundingClientRect();
                patternDragOffsetRef.current = {
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                };
                setPatternDragging(true);
              }}
            >
              <span>{patternPopup.data.type === 'UP' ? 'Staircase Uptrend Detected' : 'Staircase Downtrend Detected'}</span>
              <button
                type="button"
                className="rounded px-1 text-slate-300 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  patternDismissedScanKeyRef.current = patternCurrentScanKeyRef.current;
                  setPatternPopup((prev) => ({ ...prev, open: false }));
                }}
              >
                ✕
              </button>
            </div>
            <div className="space-y-1 px-3 py-2 text-xs text-slate-200">
              <div>Legs: {patternPopup.data.legCount}</div>
              <div>Strength: {patternPopup.data.strengthScore}/5</div>
              <div>Volume alignment: {patternPopup.data.volumeAlignment ? 'Yes' : 'No'}</div>
              <div>VWAP alignment: {patternPopup.data.vwapAlignment ? 'Yes' : 'No'}</div>
              <div>EMA slope: {patternPopup.data.emaSlopePositive ? 'Positive' : 'Negative'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
