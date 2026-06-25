import { RoleDashboard } from "@/components/dashboard/role-dashboard";

export default function PresalesDashboardPage() {
  return (
    <RoleDashboard
      role="Presales Engineer"
      sections={[
        {
          title: "Discovery 대기",
          description: "Opportunities awaiting technical discovery",
          items: [
            { label: "신규 요청", value: "4" },
            { label: "재조정 필요", value: "2" },
            { label: "미배정", value: "1" },
          ],
        },
        {
          title: "Solution Fit 검토",
          description: "Pending solution architecture reviews",
          items: [
            { label: "검토 대기", value: "3" },
            { label: "추가 정보 필요", value: "2" },
            { label: "확정", value: "1" },
          ],
        },
        {
          title: "Sizing 누락 항목",
          description: "Quotes missing sizing data",
          items: [
            { label: "스토리지", value: "2" },
            { label: "네트워크", value: "1" },
            { label: "라이선스", value: "3" },
          ],
        },
        {
          title: "PoC 준비",
          description: "PoC preps requiring attention",
          items: [
            { label: "환경 구성", value: "2" },
            { label: "스크립트 준비", value: "1" },
            { label: "고객 일정 조율", value: "3" },
          ],
        },
        {
          title: "AI Draft 검토 필요",
          description: "AI-generated technical drafts pending human review",
          items: [
            { label: "제안서", value: "3" },
            { label: "SOW", value: "1" },
            { label: "기술 문서", value: "2" },
          ],
        },
      ]}
    />
  );
}
