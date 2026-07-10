import { prisma } from "@sangfor/db";

import { createWorkTask } from "./orchestration/task-center";

/**
 * 리뉴얼·SLA 와치독 — 03-master-plan Task 5.
 *
 * 만료 임박 리뉴얼/SLA 위반 후보를 매일 스캔해 WorkTask를 생성한다.
 * 제목을 결정형(deterministic)으로 만들어 재실행 시 동일 제목이 이미 있으면
 * 건너뛰는 방식으로 멱등성을 보장한다(별도 unique 제약 없이 title 조회로 충분).
 *
 * CFO 마진(orange 게이트) 에스컬레이션은 태스크를 만들지 않고 목록만 반환한다
 * — 사람이 직접 확인해야 하는 재무 판단이라 자동 태스크화하지 않는다.
 */

export interface WatchdogPassResult {
  renewalTasksCreated: number;
  slaTasksCreated: number;
  cfoEscalations: Array<{ caseRef: string; ageDays: number }>;
  skippedExisting: number;
}

/** RenewalOpportunity 상태 중 이미 종료된 것으로 취급 — daily-report.ts와 동일 어휘. */
const RENEWAL_DONE_STATUSES = ["renewed", "cancelled", "closed", "done"];
/** SupportCase 상태 중 이미 종료된 것으로 취급 — daily-report.ts와 동일 어휘. */
const SUPPORT_CASE_DONE_STATUSES = ["resolved", "closed"];

const DAY_MS = 24 * 60 * 60 * 1000;
const RENEWAL_BUCKETS = [30, 60, 90] as const;
type RenewalBucket = (typeof RENEWAL_BUCKETS)[number];

const SLA_RESPONSE_THRESHOLD_MS = 1 * DAY_MS;
const CFO_ESCALATION_AGE_MS = 7 * DAY_MS;

function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
}

function daysSince(past: Date, now: Date): number {
  return Math.floor((now.getTime() - past.getTime()) / DAY_MS);
}

/**
 * 만료까지 남은 일수를 D-90/60/30 버킷 중 가장 촉박한 것으로 매핑한다.
 * 90일보다 여유 있으면 아직 대상 아님(null). 이미 만료됐거나 30일 이하면
 * 가장 급한 버킷(30)으로 수렴시켜 "리뉴얼 대상인데 방치" 케이스도 잡는다.
 */
function renewalBucketFor(daysUntilExpiry: number): RenewalBucket | null {
  if (daysUntilExpiry > 90) return null;
  if (daysUntilExpiry <= 30) return 30;
  if (daysUntilExpiry <= 60) return 60;
  return 90;
}

function isOrangeFail(colorGateJson: unknown): boolean {
  if (!colorGateJson || typeof colorGateJson !== "object") return false;
  const cg = colorGateJson as { failed?: unknown; pass?: unknown };
  return cg.pass === false && Array.isArray(cg.failed) && cg.failed.includes("orange");
}

async function ensureWatchdogTask(
  client: typeof prisma,
  title: string,
  customerId: string | null | undefined,
): Promise<"created" | "skipped"> {
  const existing = await client.workTask.findFirst({ where: { title } });
  if (existing) return "skipped";

  await createWorkTask({
    projectSlug: "demo-project",
    title,
    status: "todo",
    source: "watchdog",
    priority: "high",
    ...(customerId ? { customerId } : {}),
  });
  return "created";
}

export async function runWatchdogPass(deps?: {
  prisma?: typeof prisma;
  now?: Date;
}): Promise<WatchdogPassResult> {
  const client = deps?.prisma ?? prisma;
  const now = deps?.now ?? new Date();

  let renewalTasksCreated = 0;
  let slaTasksCreated = 0;
  let skippedExisting = 0;

  // ── 1) 리뉴얼 D-90/60/30 ────────────────────────────────────────────────
  const renewals = await client.renewalOpportunity.findMany({
    where: {
      status: { notIn: RENEWAL_DONE_STATUSES },
      expiresAt: { not: null },
    },
    include: { customer: true },
  });

  for (const renewal of renewals) {
    if (!renewal.expiresAt) continue;
    const bucket = renewalBucketFor(daysUntil(renewal.expiresAt, now));
    if (bucket === null) continue;

    const name = renewal.customer?.name ?? renewal.customerId;
    const title = `[와치독] 리뉴얼 D-${bucket}: ${name} (${renewal.id})`;
    const result = await ensureWatchdogTask(client, title, renewal.customerId);
    if (result === "created") renewalTasksCreated++;
    else skippedExisting++;
  }

  // ── 2) SLA 응답 임박/위반 ────────────────────────────────────────────────
  // SupportCase 스키마에는 createdAt이 없다(daily-report.ts에 이미 기록된
  // 동일 제약) — slaDeadline만 응답 SLA 리스크 신호로 쓸 수 있어, "해결(2일)"
  // SLA는 별도 필드가 없어 계산 불가. 응답 SLA만 임박/위반 판정한다.
  const supportCases = await client.supportCase.findMany({
    where: {
      status: { notIn: SUPPORT_CASE_DONE_STATUSES },
      slaDeadline: { not: null },
    },
    include: { customer: true },
  });

  for (const supportCase of supportCases) {
    if (!supportCase.slaDeadline) continue;
    const remainingMs = supportCase.slaDeadline.getTime() - now.getTime();
    if (remainingMs > SLA_RESPONSE_THRESHOLD_MS) continue;

    const state = remainingMs <= 0 ? "위반" : "임박";
    const name = supportCase.customer?.name ?? supportCase.customerId;
    const title = `[와치독] SLA 응답 ${state}: ${name} (${supportCase.id})`;
    const result = await ensureWatchdogTask(client, title, supportCase.customerId);
    if (result === "created") slaTasksCreated++;
    else skippedExisting++;
  }

  // ── 3) CFO 마진(orange) 게이트 fail 방치 에스컬레이션 ───────────────────
  // 현재 코드베이스에서 domainDecisionLog에 colorGateJson(domain='cfo')을
  // 실제로 기록하는 호출부가 아직 없다(2차 CARD-2/B-3 착지분 확인 결과) —
  // 라이브 데이터는 0건일 것으로 예상되며, 쿼리는 향후 기록이 시작되면
  // 바로 동작하도록 best-effort로 구현해둔다.
  const cutoff = new Date(now.getTime() - CFO_ESCALATION_AGE_MS);
  const cfoRows = await client.domainDecisionLog.findMany({
    where: {
      domain: "cfo",
      createdAt: { lte: cutoff },
    },
    select: { id: true, caseRef: true, colorGateJson: true, createdAt: true },
  });

  const cfoEscalations: Array<{ caseRef: string; ageDays: number }> = [];
  for (const row of cfoRows) {
    if (!row.caseRef || !isOrangeFail(row.colorGateJson)) continue;

    const laterResolved = await client.domainDecisionLog.findFirst({
      where: {
        caseRef: row.caseRef,
        createdAt: { gt: row.createdAt },
        OR: [{ outcome: "approved" }, { resolvedAt: { not: null } }],
      },
      select: { id: true },
    });
    if (laterResolved) continue;

    cfoEscalations.push({ caseRef: row.caseRef, ageDays: daysSince(row.createdAt, now) });
  }

  return {
    renewalTasksCreated,
    slaTasksCreated,
    cfoEscalations,
    skippedExisting,
  };
}
