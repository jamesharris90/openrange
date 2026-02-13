export type CatalystType = 'earnings' | 'fda' | 'product' | 'merger' | 'contract' | 'upgrade' | 'offering' | 'guidance' | 'technical' | 'sector' | 'general' | 'none';

export interface TickerInput {
  ticker: string;
  last?: number;
  pmPrice?: number;
  pmChangePct?: number;
  pmVolume?: number;
  avgVolume?: number;
  float?: number;
  sector?: string;
  pmHigh?: number;
  pmLow?: number;
}

export interface CatalystInfo {
  type: CatalystType;
  detail: string;
  earningsTiming?: string;
}

export interface MarketLevels {
  prevHigh?: number;
  prevLow?: number;
  prevClose?: number;
  pmHigh?: number;
  pmLow?: number;
  week52High?: number;
  week52Low?: number;
  htfResistance?: number;
  htfSupport?: number;
}

export interface EnrichedTicker extends TickerInput {
  catalyst: CatalystInfo | null;
  relVolume?: number;
  levels: MarketLevels;
  classification?: 'A' | 'B' | 'C';
  classificationReason?: string;
  permittedStrategies?: string[];
  primaryStrategy?: string;
  secondaryStrategy?: string;
  conditionalNote?: string;
  primaryRisk?: string;
  invalidation?: string;
  conviction?: 'HIGH' | 'MEDIUM' | 'LOW';
  tier?: 1 | 2 | 3;
  tierReason?: string;
}

export interface ThresholdConfig {
  minPrice: number;
  maxPrice: number;
  minAvgVolume: number;
  minPmVolume: number;
  minGapPct: number;
  maxFloat?: number;
}

export interface StopConditionsConfig {
  dailyLossLimit: number;
  maxLosingTrades: number;
  emotionalCheckTime: string;
  hardCloseUk: string;
}

export interface Config {
  thresholds: ThresholdConfig;
  session: {
    marketOpenUk: string;
    macroNotes?: string;
  };
  stopConditions: StopConditionsConfig;
  scannerSources: string[];
}

export interface SessionInfo {
  date: string;
  dayOfWeek: string;
  marketOpenUk: string;
  scannerSources: string[];
  tickersScanned: number;
  tickersPassing: number;
  macroNotes?: string;
}

export interface PriorityEntry {
  rank?: number;
  ticker: string;
  classification?: 'A' | 'B' | 'C';
  primaryStrategy?: string;
  conviction?: 'HIGH' | 'MEDIUM' | 'LOW';
  keyLevel?: number;
  whySecondary?: string;
  reason?: string;
}

export interface ReportJson {
  sessionInfo: SessionInfo;
  tickers: EnrichedTicker[];
  priority: {
    tier1: PriorityEntry[];
    tier2: PriorityEntry[];
    tier3: PriorityEntry[];
  };
  actionPlan: ActionPlan;
  stopConditions: StopConditionsConfig;
}

export interface ActionPlan {
  openingPhase: ActionWindow;
  midSession: ActionWindow;
  lateSession: ActionWindow;
}

export interface ActionWindow {
  title: string;
  items: string[];
}
