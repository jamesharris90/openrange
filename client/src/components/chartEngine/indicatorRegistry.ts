import { normalizeTimeframe } from '../../utils/timeframe';

export type ChartProfile = {
  key: '1m' | '3m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | 'ALL';
  label: string;
  showVWAP: boolean;
  showEMA9: boolean;
  showEMA10: boolean;
  showEMA20: boolean;
  showEMA50: boolean;
  showVolume: boolean;
  showVolumeMA20: boolean;
  showRSI: boolean;
  showPDHPDL: boolean;
  showOpeningRange: boolean;
  showOpeningRangeBox: boolean;
  openingRangeMinutes: 5 | 15;
};

export const timeframeProfiles: Record<ChartProfile['key'], { showVolume: boolean; showRSI: boolean }> = {
  '1m': { showVolume: false, showRSI: false },
  '3m': { showVolume: true, showRSI: false },
  '5m': { showVolume: true, showRSI: false },
  '15m': { showVolume: true, showRSI: false },
  '1H': { showVolume: true, showRSI: true },
  '4H': { showVolume: true, showRSI: true },
  '1D': { showVolume: true, showRSI: false },
  '1W': { showVolume: true, showRSI: false },
  'ALL': { showVolume: true, showRSI: false },
};

const PROFILE_MAP: Record<string, ChartProfile> = {
  '1D': {
    key: '1D',
    label: 'Daily (Context & Classification)',
    showVWAP: false,
    showEMA9: false,
    showEMA10: true,
    showEMA20: true,
    showEMA50: false,
    showVolume: true,
    showVolumeMA20: true,
    showRSI: false,
    showPDHPDL: false,
    showOpeningRange: false,
    showOpeningRangeBox: false,
    openingRangeMinutes: 15,
  },
  '1W': {
    key: '1W',
    label: 'Weekly (Macro Context)',
    showVWAP: false,
    showEMA9: false,
    showEMA10: false,
    showEMA20: true,
    showEMA50: true,
    showVolume: true,
    showVolumeMA20: true,
    showRSI: false,
    showPDHPDL: false,
    showOpeningRange: false,
    showOpeningRangeBox: false,
    openingRangeMinutes: 15,
  },
  'ALL': {
    key: 'ALL',
    label: 'All (Full History)',
    showVWAP: false,
    showEMA9: false,
    showEMA10: false,
    showEMA20: true,
    showEMA50: true,
    showVolume: true,
    showVolumeMA20: true,
    showRSI: false,
    showPDHPDL: false,
    showOpeningRange: false,
    showOpeningRangeBox: false,
    openingRangeMinutes: 15,
  },
  '4H': {
    key: '4H',
    label: '4H (Swing Context)',
    showVWAP: true,
    showEMA9: false,
    showEMA10: false,
    showEMA20: true,
    showEMA50: true,
    showVolume: true,
    showVolumeMA20: false,
    showRSI: true,
    showPDHPDL: true,
    showOpeningRange: true,
    showOpeningRangeBox: true,
    openingRangeMinutes: 15,
  },
  '1H': {
    key: '1H',
    label: '1H (Structure & Liquidity)',
    showVWAP: true,
    showEMA9: false,
    showEMA10: false,
    showEMA20: true,
    showEMA50: true,
    showVolume: true,
    showVolumeMA20: false,
    showRSI: true,
    showPDHPDL: true,
    showOpeningRange: true,
    showOpeningRangeBox: true,
    openingRangeMinutes: 15,
  },
  '15m': {
    key: '15m',
    label: '15m (Execution Assist)',
    showVWAP: true,
    showEMA9: true,
    showEMA10: false,
    showEMA20: true,
    showEMA50: false,
    showVolume: true,
    showVolumeMA20: false,
    showRSI: false,
    showPDHPDL: true,
    showOpeningRange: true,
    showOpeningRangeBox: true,
    openingRangeMinutes: 15,
  },
  '3m': {
    key: '3m',
    label: '3m (Execution)',
    showVWAP: true,
    showEMA9: true,
    showEMA10: false,
    showEMA20: true,
    showEMA50: false,
    showVolume: true,
    showVolumeMA20: false,
    showRSI: false,
    showPDHPDL: false,
    showOpeningRange: true,
    showOpeningRangeBox: true,
    openingRangeMinutes: 5,
  },
  '5m': {
    key: '5m',
    label: '5m (Execution)',
    showVWAP: true,
    showEMA9: true,
    showEMA10: false,
    showEMA20: true,
    showEMA50: false,
    showVolume: true,
    showVolumeMA20: false,
    showRSI: false,
    showPDHPDL: false,
    showOpeningRange: true,
    showOpeningRangeBox: true,
    openingRangeMinutes: 5,
  },
  '1m': {
    key: '1m',
    label: '1m (Micro Confirmation)',
    showVWAP: true,
    showEMA9: true,
    showEMA10: false,
    showEMA20: false,
    showEMA50: false,
    showVolume: false,
    showVolumeMA20: false,
    showRSI: false,
    showPDHPDL: false,
    showOpeningRange: false,
    showOpeningRangeBox: false,
    openingRangeMinutes: 5,
  },
};

export { normalizeTimeframe };

export function getProfileForTimeframe(value: string): ChartProfile {
  const key = normalizeTimeframe(value);
  return PROFILE_MAP[key];
}

export const CHART_TIMEFRAMES: Array<{ value: ChartProfile['key']; label: string }> = [
  { value: '1m', label: '1m' },
  { value: '3m', label: '3m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1H', label: '1h' },
  { value: '4H', label: '4h' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: 'ALL', label: 'All' },
];
