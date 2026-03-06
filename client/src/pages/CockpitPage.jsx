import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import TradingCockpit from '../components/cockpit/TradingCockpit';

export default function CockpitPage() {
  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Trading Terminal"
          subtitle="Symbol-linked modular cockpit for scanner, charting, signals, news, and order flow."
        />
      </Card>

      <TradingCockpit />
    </PageContainer>
  );
}
