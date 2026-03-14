import { useEffect } from 'react';
import { Activity } from 'lucide-react';
import { PageContainer } from '../components/layout/PagePrimitives';
import RadarMarketContext from '../components/radar/RadarMarketContext';
import RadarBeaconPanel from '../components/radar/RadarBeaconPanel';
import RadarStocksInPlay from '../components/radar/RadarStocksInPlay';
import RadarSectorRotation from '../components/radar/RadarSectorRotation';
import RadarStrategyChart from '../components/radar/RadarStrategyChart';
import RadarSignalActivity from '../components/radar/RadarSignalActivity';
import RadarOpportunityFeed from '../components/radar/RadarOpportunityFeed';
import RadarTradeNarratives from '../components/radar/RadarTradeNarratives';

export default function OpenRangeRadarPage() {
  useEffect(() => {
    document.title = 'OpenRange Radar';
  }, []);

  return (
    <PageContainer className="space-y-4">
      <section className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-2 text-emerald-400">
            <Activity size={18} />
          </div>
          <div>
            <h1 className="m-0 text-xl font-semibold tracking-tight text-slate-100">OpenRange Radar</h1>
            <p className="m-0 mt-1 text-sm text-slate-400">
              Command center for what is moving, why it is moving, and how it can be traded.
            </p>
          </div>
        </div>
      </section>

      <RadarMarketContext />

      <section className="grid gap-4 xl:grid-cols-2">
        <RadarBeaconPanel />
        <RadarStocksInPlay />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RadarSectorRotation />
        <RadarStrategyChart />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RadarSignalActivity />
        <RadarOpportunityFeed />
      </section>

      <RadarTradeNarratives />
    </PageContainer>
  );
}
