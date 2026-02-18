import React from 'react';
import { TrendingUp, ArrowUpRight, Activity, Rocket, Zap, BarChart2 } from 'lucide-react';
import ScannerSection from './ScannerSection';

const SCANNERS = [
  {
    title: 'High Volume Breakouts',
    icon: <TrendingUp size={18} />,
    description: 'Stocks hitting new 20-day highs with 2x+ relative volume.',
    filters: 'sh_avgvol_o500,ta_highlow20d_nh,sh_relvol_o2',
    sortParam: '-volume',
  },
  {
    title: 'Gap Up Movers',
    icon: <ArrowUpRight size={18} />,
    description: 'Stocks gapping up 3%+ on above-average volume.',
    filters: 'sh_avgvol_o500,ta_gap_u3',
    sortParam: '-change',
  },
  {
    title: 'High Volatility',
    icon: <Activity size={18} />,
    description: 'Names with 5%+ weekly volatility and strong volume.',
    filters: 'sh_avgvol_o500,ta_volatility_wo5',
    sortParam: '-volatility_w',
  },
  {
    title: 'Small Cap Gainers',
    icon: <Rocket size={18} />,
    description: 'Small-cap stocks up 5%+ with solid average volume.',
    filters: 'cap_smallunder,sh_avgvol_o200,ta_change_u5',
    sortParam: '-change',
  },
  {
    title: 'Momentum Continuation',
    icon: <Zap size={18} />,
    description: 'Trading above SMA20 with positive weekly performance.',
    filters: 'sh_avgvol_o500,ta_sma20_pa,ta_perf_1wup',
    sortParam: '-perf1w',
  },
  {
    title: 'Unusual Volume',
    icon: <BarChart2 size={18} />,
    description: 'Stocks with 3x+ relative volume signaling unusual activity.',
    filters: 'sh_avgvol_o300,sh_relvol_o3',
    sortParam: '-relativevolume',
  },
];

export default function ScreenersPage() {
  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Market Screeners</h2>
        <p className="muted" style={{ marginTop: 4 }}>6 live scanners with preset strategies. Toggle filters per scanner, star tickers to add to your watchlist.</p>
      </div>

      <div className="screeners-grid">
        {SCANNERS.map((scanner, idx) => (
          <ScannerSection
            key={scanner.title}
            title={scanner.title}
            icon={scanner.icon}
            description={scanner.description}
            filters={scanner.filters}
            sortParam={scanner.sortParam}
            delay={idx * 300}
          />
        ))}
      </div>
    </div>
  );
}
