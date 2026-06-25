import { RoleDashboard } from "@/components/dashboard/role-dashboard";

export default function SalesDashboardPage() {
  return (
    <RoleDashboard
      role="Sales Manager"
      sections={[
        {
          title: "내 Pipeline",
          description: "Sales pipeline by stage and weighted forecast",
          items: [
            { label: "열린 기회", value: "12" },
            { label: "가중 예상 매출", value: "$2.3M" },
            { label: "이번 분기 목표", value: "$3.8M" },
          ],
        },
        {
          title: "오늘 Follow-up",
          description: "Tasks and calls scheduled for today",
          items: [
            { label: "통화 예정", value: "5" },
            { label: "미팅 예정", value: "3" },
            { label: "이메일 작성", value: "7" },
          ],
        },
        {
          title: "승인 대기",
          description: "Pending Opportunity approvals",
          items: [
            { label: "특별 할인", value: "2" },
            { label: "조건 변경", value: "1" },
            { label: "계약 연장", value: "3" },
          ],
        },
        {
          title: "제안서 작성 중",
          description: "Proposals in progress",
          items: [
            { label: "초안", value: "4" },
            { label: "검토 중", value: "3" },
            { label: "최종 승인", value: "1" },
          ],
        },
        {
          title: "갱신 예정 고객",
          description: "Renewal alerts — 90-day window",
          items: [
            { label: "30일 이내", value: "2" },
            { label: "60일 이내", value: "5" },
            { label: "90일 이내", value: "8" },
          ],
        },
        {
          title: "위험 딜",
          description: "Deals at risk of slipping or losing",
          items: [
            { label: "경쟁 위험", value: "3" },
            { label: "가격 이슈", value: "2" },
            { label: "의사 결정 지연", value: "4" },
          ],
        },
      ]}
    />
  );
}
