import { AIWorkspaceLayout } from "@/components/ai-workspace";
import { BusinessRoleDashboardPanel } from "@/components/dashboard/business-role-dashboard-panel";

export default function DeliveryDashboardPage() {
  return (
    <AIWorkspaceLayout title="딜리버리" subtitle="역할 기반 운영 대시보드" activities={[]} stats={[]}>
      <BusinessRoleDashboardPanel role="delivery_engineer" />
    </AIWorkspaceLayout>
  );
}
