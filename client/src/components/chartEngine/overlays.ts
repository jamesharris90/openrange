import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

type Levels = {
  pdh?: number | null;
  pdl?: number | null;
  pmh?: number | null;
  pml?: number | null;
  orHigh?: number | null;
  orLow?: number | null;
  orStartTime?: number | null;
  orEndTime?: number | null;
};

type EventItem = {
  type: string;
  time: number | Time;
  title: string;
  major?: boolean;
  payload?: any;
};

export function buildLevelDefinitions(levels: Levels, showPDHPDL: boolean) {
  const lines: Array<{ id: string; price: number; title: string; color: string }> = [];
  const add = (id: string, price: number | null, title: string, color: string) => {
    if (Number.isFinite(price)) lines.push({ id, price: Number(price), title, color });
  };

  if (showPDHPDL) {
    add('pdh', levels.pdh, 'PDH', '#60a5fa');
    add('pdl', levels.pdl, 'PDL', '#f97316');
  }

  add('pmh', levels.pmh, 'PMH', '#22c55e');
  add('pml', levels.pml, 'PML', '#ef4444');

  return lines;
}

export function buildEventMarkers(events: EventItem[]) {
  const list = Array.isArray(events) ? events : [];
  const byTime = new Map<string, EventItem[]>();

  list.forEach((event) => {
    const time = event?.time;
    if (time == null) return;
    const key = typeof time === 'number'
      ? `n:${time}`
      : (typeof time === 'object' && 'year' in time)
        ? `d:${time.year}-${time.month}-${time.day}`
        : `s:${String(time)}`;
    const bucket = byTime.get(key) || [];
    bucket.push(event);
    byTime.set(key, bucket);
  });

  return Array.from(byTime.entries())
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    .slice(-80)
    .map(([_timeKey, entries]) => {
      const referenceTime = entries[0]?.time;
      if (referenceTime == null) return null;

      const hasEarnings = entries.some((event) => event?.type === 'earnings');
      const hasMajorNews = entries.some((event) => event?.type === 'news' && event?.major === true);

      if (hasEarnings) {
        return {
          time: referenceTime as Time,
          position: 'belowBar',
          color: '#10b981',
          shape: 'square',
          text: 'E',
        };
      }

      if (hasMajorNews) {
        return {
          time: referenceTime as Time,
          position: 'belowBar',
          color: '#a855f7',
          shape: 'circle',
          text: '⚡',
        };
      }

      return null;
    });
}

export function updateOrBoxElement(
  boxEl: HTMLDivElement | null,
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  levels: Levels,
  showOpeningRangeBox: boolean,
) {
  if (!boxEl) return;

  if (
    !showOpeningRangeBox
    || !chart
    || !candleSeries
    || !Number.isFinite(levels?.orHigh)
    || !Number.isFinite(levels?.orLow)
    || !Number.isFinite(levels?.orStartTime)
    || !Number.isFinite(levels?.orEndTime)
  ) {
    boxEl.style.display = 'none';
    return;
  }

  const x1 = chart.timeScale().timeToCoordinate(levels.orStartTime as Time);
  const x2 = chart.timeScale().timeToCoordinate(levels.orEndTime as Time);
  const yTop = candleSeries.priceToCoordinate(Number(levels.orHigh));
  const yBottom = candleSeries.priceToCoordinate(Number(levels.orLow));

  if (![x1, x2, yTop, yBottom].every(Number.isFinite)) {
    boxEl.style.display = 'none';
    return;
  }

  const left = Math.min(Number(x1), Number(x2));
  const right = Math.max(Number(x1), Number(x2));
  const top = Math.min(Number(yTop), Number(yBottom));
  const bottom = Math.max(Number(yTop), Number(yBottom));

  boxEl.style.display = 'block';
  boxEl.style.left = `${left}px`;
  boxEl.style.width = `${Math.max(1, right - left)}px`;
  boxEl.style.top = `${top}px`;
  boxEl.style.height = `${Math.max(1, bottom - top)}px`;
}
