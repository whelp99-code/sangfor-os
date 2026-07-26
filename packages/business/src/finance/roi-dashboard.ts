import type { AuthContext } from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";

export type MetricState = "MEASURED" | "PARTIAL" | "UNKNOWN" | "COLLECTING" | "SOURCE_UNAVAILABLE";

export interface RoiMetricItem {
  metricKey: string;
  displayName: string;
  unit: string;
  state: MetricState;
  value: number | null;
  asOf: string | null;
  sourceCount: number;
  warnings: string[];
}

export interface GetRoiDashboardInput {
  authContext: AuthContext;
}

function dashboardState(metrics: RoiMetricItem[]): MetricState {
  if (metrics.length === 0) return "UNKNOWN";
  if (metrics.every((metric) => metric.state === "MEASURED")) return "MEASURED";
  if (metrics.every((metric) => metric.state === "SOURCE_UNAVAILABLE")) return "SOURCE_UNAVAILABLE";
  if (metrics.every((metric) => metric.state === "UNKNOWN")) return "UNKNOWN";
  if (metrics.some((metric) => metric.state === "COLLECTING") && metrics.every((metric) => metric.state === "COLLECTING" || metric.state === "UNKNOWN")) return "COLLECTING";
  return "PARTIAL";
}

export async function getRoiDashboard(input: GetRoiDashboardInput) {
  const { authContext } = input;

  return withRlsTransaction(
    { tenantId: authContext.tenantId, companyId: authContext.companyId, projectId: authContext.projectId },
    async (tx) => {
      const definitions = await tx.metricDefinition.findMany({
        where: { companyId: authContext.companyId, status: "ACTIVE" },
        orderBy: [{ metricKey: "asc" }, { revision: "desc" }],
        include: { snapshots: { orderBy: { asOf: "desc" }, take: 1 } },
      });
      const latestDefinitions = new Map<string, typeof definitions[number]>();
      for (const definition of definitions) {
        if (!latestDefinitions.has(definition.metricKey)) latestDefinitions.set(definition.metricKey, definition);
      }

      const metrics: RoiMetricItem[] = [...latestDefinitions.values()].map((definition) => {
        const snapshot = definition.snapshots[0];
        if (!snapshot) {
          return {
            metricKey: definition.metricKey,
            displayName: definition.displayName,
            unit: definition.unit,
            state: "UNKNOWN" as const,
            value: null,
            asOf: null,
            sourceCount: 0,
            warnings: ["측정 스냅샷이 아직 저장되지 않았습니다."],
          };
        }

        const stale = snapshot.freshUntil.getTime() < Date.now();
        return {
          metricKey: definition.metricKey,
          displayName: definition.displayName,
          unit: definition.unit,
          state: stale ? "SOURCE_UNAVAILABLE" as const : snapshot.state,
          value: stale || snapshot.value === null ? null : Number(snapshot.value),
          asOf: snapshot.asOf.toISOString(),
          sourceCount: snapshot.sourceCount,
          warnings: stale ? ["최신 측정 근거의 유효기간이 만료되었습니다."] : [],
        };
      });
      const asOfValues = metrics.flatMap((metric) => metric.asOf ? [metric.asOf] : []);

      return {
        asOf: asOfValues.sort().at(-1) ?? null,
        companyId: authContext.companyId,
        metrics,
        overallHealth: dashboardState(metrics),
      };
    },
  );
}
