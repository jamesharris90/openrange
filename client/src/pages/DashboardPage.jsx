import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import OpenRangeRadar from '../components/radar/OpenRangeRadar';
import CalibrationDashboard from '../components/calibration/CalibrationDashboard';

export default function DashboardPage() {
  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Dashboard Intelligence"
          subtitle="OpenRange Radar Command Center powered by /api/radar/today"
        />
      </Card>
      <OpenRangeRadar />
      <CalibrationDashboard />
    </PageContainer>
  );
}
