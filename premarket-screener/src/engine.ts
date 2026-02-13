import { EarningsProvider } from '../providers/EarningsProvider';
import { MarketDataProvider } from '../providers/MarketDataProvider';
import { NewsProvider } from '../providers/NewsProvider';
import {
  ActionPlan,
  Config,
  EnrichedTicker,
  ReportJson,
  SessionInfo,
  TickerInput,
} from '../models/types';
import { hardGate } from '../scoring/gating';
import { classify } from '../scoring/classification';
import { rankTiers } from '../scoring/tiering';

/**
 * Pre-market session fraction used to normalise relative volume.
 *
 * US pre-market runs 04:00–09:30 ET (5.5 h).  Regular session is 6.5 h.
 * Most PM volume clusters in the last 1–2 hours before the open.
 * A PM volume equal to 20% of the full-day average yields relVol = 1.0,
 * meaning that ticker is tracking "normal" volume pace.  Higher = unusual
 * activity.
 */
const PM_SESSION_FRACTION = 0.20;

export async function runEngine(
  inputs: TickerInput[],
  config: Config,
  providers: {
    news: NewsProvider;
    earnings: EarningsProvider;
    market: MarketDataProvider;
  },
): Promise<ReportJson> {
  const today = new Date();
  const sessionInfo: SessionInfo = {
    date: today.toISOString().split('T')[0],
    dayOfWeek: today.toLocaleDateString('en-US', { weekday: 'long' }),
    marketOpenUk: config.session.marketOpenUk,
    scannerSources: config.scannerSources,
    tickersScanned: inputs.length,
    tickersPassing: 0,
    macroNotes: config.session.macroNotes,
  };

  const enriched: EnrichedTicker[] = [];
  const rejections: EnrichedTicker[] = [];

  for (const input of inputs) {
    const catalystNews = await providers.news.getCatalyst(input);
    const earningsCat = await providers.earnings.getEarningsContext(input);
    const catalyst = catalystNews ?? earningsCat;

    const levels = await providers.market.getLevels(input);

    // Relative volume: pmVolume / (avgVolume × sessionFraction)
    const relVolume =
      input.pmVolume && input.avgVolume
        ? input.pmVolume / (input.avgVolume * PM_SESSION_FRACTION)
        : undefined;

    const base: EnrichedTicker = {
      ...input,
      catalyst,
      relVolume,
      levels,
    };

    const gate = hardGate(input, catalyst, config.thresholds);
    if (!gate.pass) {
      base.tier = 3;
      base.tierReason = gate.reason ?? 'Failed gate';
      rejections.push(base);
      continue;
    }

    const withClass = classify(base);
    enriched.push(withClass);
  }

  sessionInfo.tickersPassing = enriched.length;

  const priority = rankTiers(enriched);

  // Write tier assignments back onto enriched tickers
  for (const t of enriched) {
    const t1Entry = priority.tier1.find((p) => p.ticker === t.ticker);
    const t2Entry = priority.tier2.find((p) => p.ticker === t.ticker);
    if (t1Entry) {
      t.tier = 1;
      t.tierReason = 'Primary focus';
    } else if (t2Entry) {
      t.tier = 2;
      t.tierReason = t2Entry.whySecondary ?? 'Secondary focus';
    } else {
      t.tier = 3;
      t.tierReason = 'Did not rank into Tier 1 or 2';
    }
  }

  const allTickers = [...enriched, ...rejections];

  const actionPlan = buildActionPlan(enriched, priority);

  return {
    sessionInfo,
    tickers: allTickers,
    priority,
    actionPlan,
    stopConditions: config.stopConditions,
  };
}

// ─── Dynamic action plan based on actual ticker analysis ───────────────────────

function buildActionPlan(
  enriched: EnrichedTicker[],
  priority: ReportJson['priority'],
): ActionPlan {
  const orbCandidates = priority.tier1
    .filter((p) => {
      const t = enriched.find((e) => e.ticker === p.ticker);
      return t?.permittedStrategies?.some((s) => s.includes('ORB'));
    })
    .map((p) => p.ticker);

  const bounceCandidates = [...priority.tier1, ...priority.tier2]
    .filter((p) => {
      const t = enriched.find((e) => e.ticker === p.ticker);
      return t?.permittedStrategies?.some((s) => s.includes('Support Bounce'));
    })
    .map((p) => p.ticker);

  const vwapCandidates = enriched
    .filter((t) =>
      t.permittedStrategies?.some((s) => s.includes('VWAP Reclaim')),
    )
    .map((t) => t.ticker);

  const classCNames = enriched
    .filter((t) => t.classification === 'C')
    .map((t) => t.ticker);

  const pullbackLevels = priority.tier1
    .map((p) => {
      const t = enriched.find((e) => e.ticker === p.ticker);
      if (!t) return '';
      const lvl = t.levels.pmLow ?? t.levels.prevClose;
      return lvl ? `${t.ticker} @ ${lvl.toFixed(2)}` : '';
    })
    .filter(Boolean);

  return {
    openingPhase: {
      title: 'Opening Phase (14:30–15:30 UK)',
      items: [
        `Primary ORB Candidates: ${orbCandidates.join(', ') || 'None identified'}`,
        'What Needs to Happen for Entry: Hold PM highs into open, break ORB range with volume confirmation',
        `If ORB Fails, Switch To: ${bounceCandidates.length > 0 ? `Support Bounce on ${bounceCandidates.slice(0, 2).join(', ')}` : 'VWAP Reclaim setups if structure holds'}`,
        'Maximum Trades This Window: 2',
      ],
    },
    midSession: {
      title: 'Mid-Session (15:30–18:30 UK)',
      items: [
        `Support Bounce Candidates: ${bounceCandidates.join(', ') || 'Re-evaluate Tier 1/2 names at HTF support'}`,
        `Levels I Am Watching for Pullbacks: ${pullbackLevels.join('; ') || 'PM lows and HTF support on Tier 1 names'}`,
        `Class C Names to Check for Confirmation: ${classCNames.join(', ') || 'None'} — ONLY after confirmed VWAP reclaim`,
      ],
    },
    lateSession: {
      title: 'Late Session (18:30–20:45 UK)',
      items: [
        `VWAP Reclaim Candidates: ${vwapCandidates.join(', ') || 'Re-evaluate any name that flushed but reclaimed'}`,
        'Position Size Adjustment: Half size unless A-class setup with fresh catalyst',
        'Conditions That Cancel This Window: Daily loss limit hit, 3+ losing trades, or all invalidation levels breached',
      ],
    },
  };
}
