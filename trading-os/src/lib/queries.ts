import { getAlerts as getAlertsFeed } from "@/lib/api/alerts";
import { getCatalystSignals } from "@/lib/api/catalysts";
import { getHeatmapRows } from "@/lib/api/heatmap";
import { getMarketRegime } from "@/lib/api/markets";
import { runGapScanner } from "@/lib/api/opportunities";
import { getStocksInPlay } from "@/lib/api/stocks";
import type { AlertItem, CatalystItem, RegimeInput, SectorMomentum, SignalRow } from "@/lib/types";

export async function getSectorMomentum(): Promise<SectorMomentum[]> {
  const rows = await getHeatmapRows();
  const bySector = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.sector] = (acc[row.sector] || 0) + row.change_percent;
    return acc;
  }, {});

  return Object.entries(bySector)
    .map(([sector, score]) => ({ sector, score, change_pct: score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

export async function getInstitutionalFlowCandidates(): Promise<SignalRow[]> {
  const rows = await getStocksInPlay({ minRvol: 1.5 });
  return rows.map((row) => ({
    ticker: row.symbol,
    setup: row.strategy,
    confidence: row.confidence,
    probability: row.probability,
    volume_ratio: row.expected_move,
    change_pct: row.expected_move,
  }));
}

export async function getIntradayVolumeSpikes(): Promise<SignalRow[]> {
  return getInstitutionalFlowCandidates();
}

export async function getGapCandidates(): Promise<SignalRow[]> {
  const rows = await runGapScanner();
  return rows.map((row) => ({
    ticker: row.symbol,
    setup: row.strategy,
    confidence: row.confidence,
    probability: row.probability,
    volume_ratio: row.expected_move,
    change_pct: row.expected_move,
  }));
}

export async function getMarketRegimeInputs(): Promise<RegimeInput> {
  const row = await getMarketRegime();
  return {
    vix: row.vix,
    breadth: row.breadth,
    put_call: row.put_call,
    regime: row.regime || "",
  };
}

export async function getCatalysts(): Promise<CatalystItem[]> {
  const grouped = await getCatalystSignals();
  return Object.values(grouped)
    .flat()
    .slice(0, 30)
    .map((row) => ({
      ticker: row.symbol,
      catalyst: row.catalyst || row.strategy,
      impact: "medium",
      timestamp: new Date().toISOString(),
    }));
}

export async function getAlerts(): Promise<AlertItem[]> {
  const rows = await getAlertsFeed();
  return rows.map((row) => ({
    id: row.id,
    ticker: row.symbol,
    condition: row.signal,
    enabled: true,
    last_triggered_at: row.timestamp,
  }));
}
