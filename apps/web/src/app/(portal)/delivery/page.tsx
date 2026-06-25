import { RoleDashboard } from "@/components/dashboard/role-dashboard";

export default function DeliveryDashboardPage() {
  return (
    <RoleDashboard
      role="Delivery Engineer"
      sections={[
        {
          title: "구축 예정",
          description: "Upcoming deployment schedules",
          items: [
            { label: "이번 주", value: "2" },
            { label: "다음 주", value: "3" },
            { label: "일정 미확정", value: "1" },
          ],
        },
        {
          title: "SOW 확인 필요",
          description: "Statement of Work pending confirmation",
          items: [
            { label: "고객 서명 대기", value: "3" },
            { label: "내부 검토 중", value: "2" },
            { label: "수정 필요", value: "1" },
          ],
        },
        {
          title: "License Activation 필요",
          description: "Pending license activations",
          items: [
            { label: "NGAF", value: "2" },
            { label: "aDesk", value: "1" },
            { label: "HCI", value: "3" },
          ],
        },
        {
          title: "Acceptance Checklist",
          description: "Items awaiting customer sign-off",
          items: [
            { label: "기능 테스트", value: "2" },
            { label: "성능 검증", value: "1" },
            { label: "문서 전달", value: "3" },
          ],
        },
        {
          title: "Handover 문서",
          description: "Handover documentation status",
          items: [
            { label: "작성 중", value: "2" },
            { label: "검토 대기", value: "1" },
            { label: "완료", value: "4" },
          ],
        },
      ]}
    />
  );
}
