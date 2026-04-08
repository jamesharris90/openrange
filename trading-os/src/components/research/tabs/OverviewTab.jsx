"use client";

import CompanyProfileCard from "@/components/research/CompanyProfileCard";
import InsightBlock from "@/components/research/InsightBlock";
import MetricGridCard from "@/components/research/MetricGridCard";
import { Card, CardContent } from "@/components/ui/card";
import { formatCompactNumber, formatCurrency, formatMetricPercent, formatPercent, formatText, isNullDisplay } from "@/components/research/formatters";

function StatCard({ label, value, tone = "text-slate-100" }) {
  const isEmpty = isNullDisplay(value);

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className={`mt-2 text-2xl font-semibold ${isEmpty ? "text-slate-500" : tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function OverviewTab({ research, context, terminal }) {
  const price = terminal.price;
  const momentumFlow = terminal.scanner?.momentum_flow || {};
  const marketStructure = terminal.scanner?.market_structure || {};
  const changeTone = Number(price?.change_percent || 0) >= 0 ? "text-emerald-300" : "text-rose-300";

  return (
    <div className="space-y-4">
      <CompanyProfileCard symbol={research.symbol} profile={terminal.profile} />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Latest Print" value={formatCurrency(price?.price)} />
        <StatCard label="Session Change" value={formatPercent(price?.change_percent)} tone={changeTone} />
        <StatCard label="ATR" value={formatCurrency(price?.atr)} />
      </div>

      <MetricGridCard
        title="Momentum & Flow"
        description="The live velocity layer used to identify whether a ticker is actually in play."
        items={[
          { label: "Price", value: formatCurrency(momentumFlow.price) },
          { label: "Change %", value: formatMetricPercent(momentumFlow.change_percent) },
          { label: "Gap %", value: formatMetricPercent(momentumFlow.gap_percent) },
          { label: "Relative Volume", value: formatCompactNumber(momentumFlow.relative_volume) },
          { label: "Volume", value: formatCompactNumber(momentumFlow.volume) },
          { label: "Pre-Market Change %", value: formatMetricPercent(momentumFlow.premarket_change_percent) },
          { label: "Pre-Market Volume", value: formatCompactNumber(momentumFlow.premarket_volume) },
          { label: "Change from Open %", value: formatMetricPercent(momentumFlow.change_from_open_percent) },
        ]}
      />

      <MetricGridCard
        title="Market Structure"
        description="Liquidity and capitalization context for spread tolerance, sizing, and squeeze sensitivity."
        items={[
          { label: "Market Cap", value: formatCompactNumber(marketStructure.market_cap) },
          { label: "Float", value: formatCompactNumber(marketStructure.float_shares) },
          { label: "Short Float %", value: formatMetricPercent(marketStructure.short_float_percent, { signed: false }) },
          { label: "Avg Volume", value: formatCompactNumber(marketStructure.avg_volume) },
          { label: "Spread %", value: formatMetricPercent(marketStructure.spread_percent, { signed: false }) },
          { label: "Shares Outstanding", value: formatCompactNumber(marketStructure.shares_outstanding) },
          { label: "Sector", value: formatText(marketStructure.sector) },
          { label: "Exchange", value: formatText(marketStructure.exchange) },
        ]}
      />

      <InsightBlock title="Overview Read" body={terminal.why_moving?.summary || context?.narrative || "Decision context is still building."} />
    </div>
  );
}