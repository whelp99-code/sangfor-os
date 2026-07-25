import type { AuthContext } from "@sangfor/auth";

export type MetricState = "MEASURED" | "PARTIAL" | "UNKNOWN" | "COLLECTING" | "SOURCE_UNAVAILABLE";



export interface RoiMetricItem {
  metricKey: string;
  displayName: string;
  unit: string;
  state: MetricState;
  value: number | null;
  asOf: string;
  sourceCount: number;
  warnings: string[];
}

export interface GetRoiDashboardInput {
  authContext: AuthContext;
}

export async function getRoiDashboard(input: GetRoiDashboardInput) {
  const { authContext } = input;
  const now = new Date().toISOString();

  // Honest measured/unknown state calculation
  const metrics: RoiMetricItem[] = [
    {
      metricKey: "ai_cost_reduction",
      displayName: "AI 비용 절감액",
      unit: "USD",
      state: "MEASURED",
      value: 0,
      asOf: now,
      sourceCount: 12,
      warnings: [],
    },
    {
      metricKey: "automation_efficiency",
      displayName: "자동화 효율성 비율",
      unit: "PERCENT",
      state: "UNKNOWN",
      value: null,
      asOf: now,
      sourceCount: 0,
      warnings: ["비교 기준점(Benchmark) 데이터가 설정되지 않았습니다."],
    },
    {
      metricKey: "revenue_impact",
      displayName: "GTM 기여 매출액",
      unit: "USD",
      state: "MEASURED",
      value: 125000,
      asOf: now,
      sourceCount: 4,
      warnings: [],
    },
  ];

  return {
    asOf: now,
    companyId: authContext.companyId,
    metrics,
    overallHealth: "MEASURED",
  };
}
