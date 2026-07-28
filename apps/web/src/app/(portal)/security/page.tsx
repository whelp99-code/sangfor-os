import { AIWorkspaceLayout } from "@/components/ai-workspace";
import { BusinessRoleDashboardPanel } from "@/components/dashboard/business-role-dashboard-panel";

export default function SecurityPage() {
  return (
    <AIWorkspaceLayout
      title="보안 워크스페이스"
      subtitle="위험 작업 정책, 승인 책임, 감사/증적 준비 상태"
      activities={[]}
      stats={[]}
    >
      <BusinessRoleDashboardPanel role="security_officer" />
    </AIWorkspaceLayout>
  );
}
