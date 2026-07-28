import { AIWorkspaceLayout } from "@/components/ai-workspace";
import { BusinessRoleDashboardPanel } from "@/components/dashboard/business-role-dashboard-panel";

export default function SalesDashboardPage() {
  return (
    <AIWorkspaceLayout title="영업" subtitle="역할 기반 운영 대시보드" activities={[]} stats={[]}>
      <BusinessRoleDashboardPanel role="sales_manager" />
    </AIWorkspaceLayout>
  );
}
