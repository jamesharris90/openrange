import React from 'react';
import { TrendingUp, ArrowUpRight, Activity, Rocket, Zap, BarChart2 } from 'lucide-react';
import ScannerSection from './ScannerSection';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';

const SCANNERS = [
  {
    title: 'High Volume Breakouts',
    icon: <TrendingUp size={18} />,
    description: 'Stocks hitting new 20-day highs with 2x+ relative volume.',
    queryPreset: { rvolMin: 2, volumeMin: 500000, priceMin: 5 }
  },
  {
    title: 'Gap Up Movers',
    icon: <ArrowUpRight size={18} />,
    description: 'Stocks gapping up 3%+ on above-average volume.',
    queryPreset: { gapMin: 3, rvolMin: 1.5, volumeMin: 200000, priceMin: 3 }
  },
  {
    title: 'High Volatility',
    icon: <Activity size={18} />,
    description: 'Names with 5%+ weekly volatility and strong volume.',
    queryPreset: { rvolMin: 1.8, volumeMin: 300000, priceMin: 2 }
  },
  {
    title: 'Small Cap Gainers',
    icon: <Rocket size={18} />,
    description: 'Small-cap stocks up 5%+ with solid average volume.',
    queryPreset: { marketCapMax: 2000000000, rvolMin: 2, priceMin: 1 }
  },
  {
    title: 'Momentum Continuation',
    icon: <Zap size={18} />,
    description: 'Trading above SMA20 with positive weekly performance.',
    queryPreset: { rvolMin: 1.5, volumeMin: 250000, priceMin: 2 }
  },
  {
    title: 'Unusual Volume',
    icon: <BarChart2 size={18} />,
    description: 'Stocks with 3x+ relative volume signaling unusual activity.',
    queryPreset: { rvolMin: 3, volumeMin: 300000, priceMin: 1 }
  },
];

export default function ScreenersPage() {
  return (
    <PageContainer className="space-y-4">
      <PageHeader
        title="Market Screeners"
        subtitle="6 live scanners with preset strategies. Toggle filters per scanner, star tickers to add to your watchlist."
      />

      <div className="screeners-grid">
        {SCANNERS?.map((scanner, idx) => (
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
    </PageContainer>
  );
}
