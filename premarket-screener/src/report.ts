import {
  ActionPlan,
  EnrichedTicker,
  ReportJson,
  SessionInfo,
  StopConditionsConfig,
} from '../models/types';

export function buildReportMd(
  session: SessionInfo,
  tickers: EnrichedTicker[],
  priority: ReportJson['priority'],
  actionPlan: ActionPlan,
  stops: StopConditionsConfig,
): string {
  const lines: string[] = [];

  // ── SESSION INFO ──────────────────────────────────────────────────────────────
  lines.push('# Daily Scanner Analysis — Pre-Market Watchlist');
  lines.push('');
  lines.push('## SESSION INFO');
  lines.push(`- **Date:** ${session.date}`);
  lines.push(`- **Day of Week:** ${session.dayOfWeek}`);
  lines.push(`- **Market Open (UK Time):** ${session.marketOpenUk}`);
  lines.push(`- **Scanner Sources Used:** ${session.scannerSources.join(', ')}`);
  lines.push(`- **Number of Tickers Scanned:** ${session.tickersScanned}`);
  lines.push(`- **Number Passing Initial Filter:** ${session.tickersPassing}`);
  lines.push(`- **Macro/Sector Notes:** ${session.macroNotes ?? 'N/A'}`);
  lines.push('');

  // ── TICKER DETAIL BLOCKS (only enriched / classified tickers) ─────────────────
  const enriched = tickers.filter((t) => t.classification != null);
  const rejected = tickers.filter((t) => t.classification == null);

  lines.push('## TICKER ANALYSIS');
  lines.push('');

  for (const t of enriched) {
    lines.push('---');
    lines.push('');
    lines.push(`### ${t.ticker}`);
    lines.push('');
    lines.push(`**Price:** ${fmt(t.pmPrice ?? t.last)}`);
    lines.push(`**Catalyst Type:** ${t.catalyst?.type ?? 'N/A'}`);
    lines.push(`**Catalyst Detail:** ${t.catalyst?.detail ?? 'N/A'}`);
    lines.push(`**Earnings Timing:** ${t.catalyst?.earningsTiming ?? 'N/A'}`);
    lines.push(`**Float / Avg Volume:** ${fmtInt(t.float)} / ${fmtInt(t.avgVolume)}`);
    lines.push(`**Relative Volume (PM):** ${t.relVolume != null ? t.relVolume.toFixed(2) + 'x' : 'N/A'}`);
    lines.push('');

    lines.push('**KEY LEVELS:**');
    lines.push(`- Previous Day High: ${fmt(t.levels.prevHigh)}`);
    lines.push(`- Previous Day Low: ${fmt(t.levels.prevLow)}`);
    lines.push(`- Previous Day Close: ${fmt(t.levels.prevClose)}`);
    lines.push(`- Pre-Market High: ${fmt(t.levels.pmHigh)}`);
    lines.push(`- Pre-Market Low: ${fmt(t.levels.pmLow)}`);
    lines.push(`- 52-Week High / Low: ${fmt(t.levels.week52High)} / ${fmt(t.levels.week52Low)}`);
    lines.push(`- HTF Resistance: ${fmt(t.levels.htfResistance)}`);
    lines.push(`- HTF Support: ${fmt(t.levels.htfSupport)}`);
    lines.push('');

    lines.push('**CLASSIFICATION:**');
    lines.push(`- Classification: **${t.classification}**`);
    lines.push(`- Classification Reasoning: ${t.classificationReason ?? 'N/A'}`);
    lines.push(`- Permitted Strategies: ${(t.permittedStrategies ?? []).join(', ') || 'N/A'}`);
    lines.push(`- Primary Strategy: ${t.primaryStrategy ?? 'N/A'}`);
    lines.push(`- Secondary Strategy: ${t.secondaryStrategy ?? 'N/A'}`);
    lines.push(`- Conditional Note: ${t.conditionalNote ?? 'N/A'}`);
    lines.push('');

    lines.push('**RISK ASSESSMENT:**');
    lines.push(`- Primary Risk: ${t.primaryRisk ?? 'N/A'}`);
    lines.push(`- Invalidation: ${t.invalidation ?? 'N/A'}`);
    lines.push(`- Conviction: **${t.conviction ?? 'N/A'}**`);
    lines.push('');
  }

  // ── PRIORITY RANKING ─────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## PRIORITY RANKING');
  lines.push('');

  lines.push('### Tier 1: Primary Focus (MAX 4 tickers)');
  if (priority.tier1.length > 0) {
    lines.push('');
    lines.push('| Rank | Ticker | Class | Primary Strategy | Conviction | Key Level |');
    lines.push('|------|--------|-------|------------------|------------|-----------|');
    for (const p of priority.tier1) {
      lines.push(
        `| ${p.rank ?? '-'} | ${p.ticker} | ${p.classification ?? '-'} | ${p.primaryStrategy ?? '-'} | ${p.conviction ?? '-'} | ${p.keyLevel != null ? p.keyLevel.toFixed(2) : 'N/A'} |`,
      );
    }
  } else {
    lines.push('- None');
  }
  lines.push('');

  lines.push('### Tier 2: Secondary Watch');
  if (priority.tier2.length > 0) {
    lines.push('');
    lines.push('| Rank | Ticker | Class | Strategy If Active | Conviction | Why Secondary? |');
    lines.push('|------|--------|-------|--------------------|------------|----------------|');
    for (const p of priority.tier2) {
      lines.push(
        `| ${p.rank ?? '-'} | ${p.ticker} | ${p.classification ?? '-'} | ${p.primaryStrategy ?? '-'} | ${p.conviction ?? '-'} | ${p.whySecondary ?? 'N/A'} |`,
      );
    }
  } else {
    lines.push('- None');
  }
  lines.push('');

  lines.push('### Tier 3: Do Not Trade Today');
  // Merge ranked-tier3 (from classification) + gate rejections
  const tier3All = [
    ...priority.tier3,
    ...rejected.map((t) => ({
      ticker: t.ticker,
      reason: t.tierReason ?? 'Failed gate',
    })),
  ];

  if (tier3All.length > 0) {
    lines.push('');
    lines.push('| Ticker | Reason for Exclusion |');
    lines.push('|--------|----------------------|');
    for (const p of tier3All) {
      lines.push(`| ${p.ticker} | ${p.reason ?? 'Excluded'} |`);
    }
  } else {
    lines.push('- None');
  }
  lines.push('');

  // ── SESSION ACTION PLAN ──────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## SESSION ACTION PLAN');
  lines.push('');

  lines.push(`### ${actionPlan.openingPhase.title}`);
  for (const item of actionPlan.openingPhase.items) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push(`### ${actionPlan.midSession.title}`);
  for (const item of actionPlan.midSession.items) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push(`### ${actionPlan.lateSession.title}`);
  for (const item of actionPlan.lateSession.items) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  // ── STOP CONDITIONS ──────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## STOP CONDITIONS');
  lines.push('');
  lines.push(`- **Daily Monetary Loss Limit:** $${stops.dailyLossLimit}`);
  lines.push(`- **Maximum Losing Trades:** ${stops.maxLosingTrades}`);
  lines.push(`- **Emotional Check-In Time:** ${stops.emotionalCheckTime} (UK)`);
  lines.push(`- **Hard Close Time (UK):** ${stops.hardCloseUk}`);
  lines.push('');

  return lines.join('\n');
}

function fmt(n?: number): string {
  return n == null ? 'N/A' : n.toFixed(2);
}

function fmtInt(n?: number): string {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
}
