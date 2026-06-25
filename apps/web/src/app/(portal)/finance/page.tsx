import { RoleDashboard } from "@/components/dashboard/role-dashboard";

export default function FinanceDashboardPage() {
  return (
    <RoleDashboard
      role="Finance Manager"
      sections={[
        {
          title: "Commercial Approval Queue",
          description: "Pending financial approvals",
          items: [
            { label: "특별 조건", value: "3" },
            { label: "계약 변경", value: "2" },
            { label: "신규 Deal", value: "5" },
          ],
        },
        {
          title: "낮은 마진 딜",
          description: "Deals below margin threshold",
          items: [
            { label: "마진 10% 미만", value: "2" },
            { label: "마진 15% 미만", value: "4" },
            { label: "마이너스 마진", value: "1" },
          ],
        },
        {
          title: "높은 할인 요청",
          description: "Discount requests exceeding policy",
          items: [
            { label: "30% 초과", value: "2" },
            { label: "20-30%", value: "3" },
            { label: "정책 예외 요청", value: "1" },
          ],
        },
        {
          title: "견적 Diff",
          description: "Quote vs actual discrepancies",
          items: [
            { label: "견적 초과", value: "3" },
            { label: "누락 항목", value: "2" },
            { label: "단가 불일치", value: "1" },
          ],
        },
        {
          title: "예외 Payment Term",
          description: "Non-standard payment term requests",
          items: [
            { label: "연부금", value: "2" },
            { label: "선납 조건", value: "1" },
            { label: "연체 계정", value: "3" },
          ],
        },
      ]}
    />
  );
}
