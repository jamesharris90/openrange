export type DrawingObject = Record<string, unknown>;

export interface ChartSessionState {
  ticker: string;
  timeframe: string;
  showMACD: boolean;
  showRSI: boolean;
  showExpectedMove: boolean;
  showATRProjection?: boolean;
  showVolatilityPanel?: boolean;
  drawingObjects: DrawingObject[];
  zoomRange?: unknown;
  toggles?: Record<string, boolean>;
}

const STORAGE_KEY = 'openrange_chart_session';

export function saveChartSession(state: Partial<ChartSessionState>) {
  try {
    const current = loadChartSession() || {};
    const next = { ...current, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (_error) {
  }
}

export function loadChartSession(): ChartSessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export function clearChartSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_error) {
  }
}
