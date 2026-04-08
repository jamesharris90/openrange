"use client";

import MetricGridCard from "@/components/research/MetricGridCard";
import ResearchChartPanel from "@/components/research/ResearchChartPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompactNumber, formatCurrency, formatMetricPercent, formatPercent, formatText } from "@/components/research/formatters";

export default function PriceTab({ symbol, terminal }) {
  const price = terminal.price;
  const momentumFlow = terminal.scanner?.momentum_flow || {};
  const marketStructure = terminal.scanner?.market_structure || {};

  return (
    <div className="space-y-4">
      <ResearchChartPanel symbol={symbol} />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-slate-800/80 bg-slate-950/50">
          <CardHeader>
            <CardTitle>Latest Print</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-slate-100">{formatCurrency(price?.price)}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-800/80 bg-slate-950/50">
          <CardHeader>
            <CardTitle>Reference Move</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold ${(price?.change_percent || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {formatPercent(price?.change_percent)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-800/80 bg-slate-950/50">
          <CardHeader>
            <CardTitle>ATR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-slate-100">{formatCurrency(price?.atr)}</div>
          </CardContent>
        </Card>
      </div>

      <MetricGridCard
        title="Momentum & Flow"
        description="The live velocity layer used to identify whether a ticker is truly in play."
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
        description="Liquidity and capitalization context supporting spread tolerance, position sizing, and squeeze sensitivity."
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
    </div>
  );
}