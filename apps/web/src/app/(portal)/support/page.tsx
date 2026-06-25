import { RoleDashboard } from "@/components/dashboard/role-dashboard";

export default function SupportDashboardPage() {
  return (
    <RoleDashboard
      role="Support Engineer"
      sections={[
        {
          title: "신규 Ticket",
          description: "New support tickets today",
          items: [
            { label: "Critical", value: "2" },
            { label: "High", value: "5" },
            { label: "Medium/Low", value: "8" },
          ],
        },
        {
          title: "SLA 임박",
          description: "Tickets approaching SLA deadlines",
          items: [
            { label: "1시간 이내", value: "1" },
            { label: "4시간 이내", value: "3" },
            { label: "24시간 이내", value: "6" },
          ],
        },
        {
          title: "Vendor Escalation",
          description: "Escalations to Sangfor HQ / third-party",
          items: [
            { label: "Sangfor L3", value: "2" },
            { label: "파트너 엔지니어", value: "1" },
            { label: "보안 팀", value: "1" },
          ],
        },
        {
          title: "RCA 작성 필요",
          description: "Tickets requiring Root Cause Analysis",
          items: [
            { label: "미작성", value: "4" },
            { label: "초안", value: "2" },
            { label: "고객 검토 대기", value: "1" },
          ],
        },
        {
          title: "반복 장애 고객",
          description: "Customers with recurring issues",
          items: [
            { label: "3회 이상", value: "2" },
            { label: "2회", value: "4" },
            { label: "신규 패턴", value: "1" },
          ],
        },
      ]}
    />
  );
}
