import type { RouteCapabilityClass, RouteCapabilityDefinition } from "@sangfor/auth";

/**
 * U015/SEC-02a — the static, canonical classification of every apps/web guarded API entry point
 * (the exact 68-file mechanical coverage set — U022/APR-01b added the 68th, `approvals/
 * [approvalId]/decisions/route.ts` — the union of `assertApiAccess(` and
 * `authorizeOperatorRequest(` route.ts files, re-derived and byte-verified against
 * route-capability-registry.test.ts on every test run). Keyed by repo-relative source path so the
 * key set can be diffed directly against a fresh filesystem scan — an unclassified guarded
 * mutation, or an entry whose `permission` is not in @sangfor/auth's BusinessPermission set, fails
 * that test. Route source path -> class/permission mapping is a best-effort, domain-name-driven
 * assignment onto the nearest existing BusinessPermission (documented per group below); a
 * follow-up unit may refine per-route granularity.
 */

export type RouteCapabilityKey = string;

const PRIVILEGED: Record<RouteCapabilityKey, RouteCapabilityDefinition> = {
  "apps/web/src/app/api/finance/[...path]/route.ts": { capabilityClass: "privileged", permission: "finance.write" },
  "apps/web/src/app/api/mcp/tools/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/settings/llm/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/ops/apm-test/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/github/pr/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/autopilot/config/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/engineer/rag/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/engineer/domain-proposal/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/aios-v3/workflow/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/portal/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/approvals/[approvalId]/decisions/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/approvals/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
};

const AUTHENTICATED: Record<RouteCapabilityKey, RouteCapabilityDefinition> = {
  "apps/web/src/app/api/auth/logout/route.ts": { capabilityClass: "authenticated" },
};

const POST_U048_GOVERNED: Record<RouteCapabilityKey, RouteCapabilityDefinition> = {
  "apps/web/src/app/api/approvals/[approvalId]/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/archive/route.ts": { capabilityClass: "project-assigned", permission: "delivery.read" },
  "apps/web/src/app/api/archive/[entityType]/[id]/restore/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/artifacts/[artifactId]/access/route.ts": { capabilityClass: "privileged", permission: "restricted_data.read" },
  "apps/web/src/app/api/artifacts/[artifactId]/exports/route.ts": { capabilityClass: "privileged", permission: "restricted_data.read" },
  "apps/web/src/app/api/artifacts/[artifactId]/quality/evaluations/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/artifacts/[artifactId]/quality/reviews/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/artifacts/[artifactId]/quality/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/artifacts/[artifactId]/release-evaluation/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/artifacts/[artifactId]/versions/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/catalog/imports/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/catalog/products/[id]/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/catalog/products/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/catalog/rules/[id]/publish/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/catalog/rules/[id]/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/catalog/rules/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/dashboard/[role]/route.ts": { capabilityClass: "authenticated" },
  "apps/web/src/app/api/dashboard/roi/route.ts": { capabilityClass: "privileged", permission: "finance.read" },
  "apps/web/src/app/api/delivery/people/route.ts": { capabilityClass: "project-assigned", permission: "delivery.read" },
  "apps/web/src/app/api/delivery/people/[membershipId]/credentials/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/engagements/[id]/acceptance/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/engagements/[id]/engineer-assignments/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/engagements/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/engagements/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/exports/[exportId]/route.ts": { capabilityClass: "privileged", permission: "restricted_data.read" },
  "apps/web/src/app/api/internal/external-actions/receipts/consume/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/internal/external-actions/releases/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/operator/drills/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/operator/remediations/[action]/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/operator/renewals/run/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/operator/scheduler/runs/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/opportunities/[id]/qualification/route.ts": { capabilityClass: "project-assigned", permission: "opportunity.write" },
  "apps/web/src/app/api/opportunities/[id]/quotes/route.ts": { capabilityClass: "project-assigned", permission: "quote.write" },
  "apps/web/src/app/api/opportunities/[id]/vendor-requests/route.ts": { capabilityClass: "project-assigned", permission: "opportunity.write" },
  "apps/web/src/app/api/opportunities/[id]/workflow-runs/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/quotes/[id]/commercial-approval/route.ts": { capabilityClass: "project-assigned", permission: "quote.approve_discount" },
  "apps/web/src/app/api/quotes/[id]/discount-requests/route.ts": { capabilityClass: "project-assigned", permission: "quote.approve_discount" },
  "apps/web/src/app/api/quotes/[id]/release/route.ts": { capabilityClass: "project-assigned", permission: "quote.write" },
  "apps/web/src/app/api/quotes/[id]/route.ts": { capabilityClass: "project-assigned", permission: "quote.write" },
  "apps/web/src/app/api/security/ownership-transfers/[id]/execute/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/security/ownership-transfers/preview/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/security/ownership-transfers/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/security/retention/preview/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/security/retention/runs/[runId]/approval-requests/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/security/retention/runs/[runId]/execute/route.ts": { capabilityClass: "privileged", permission: "system.admin" },
  "apps/web/src/app/api/security/role-changes/[id]/decisions/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/security/role-changes/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
  "apps/web/src/app/api/support/[id]/close/route.ts": { capabilityClass: "project-assigned", permission: "support.write" },
  "apps/web/src/app/api/support/[id]/rca/route.ts": { capabilityClass: "project-assigned", permission: "support.write" },
  "apps/web/src/app/api/support/[id]/route.ts": { capabilityClass: "project-assigned", permission: "support.write" },
  "apps/web/src/app/api/support/[id]/vendor-escalations/route.ts": { capabilityClass: "project-assigned", permission: "support.escalate" },
  "apps/web/src/app/api/support/route.ts": { capabilityClass: "project-assigned", permission: "support.write" },
  "apps/web/src/app/api/vendor-requests/[id]/events/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/vendor-requests/[id]/outcomes/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/vendor-requests/[id]/owner/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/workflow-definitions/[id]/activate/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/workflow-definitions/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/workflow-runs/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/workflow-runs/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
};

// project-assigned: ordinary company/project business CRUD and delivery/automation tooling. Each
// entry's permission is the closest existing @sangfor/auth BusinessPermission for its domain —
// customer-adjacent entities (contacts, partners, mail intake/insight) map onto customer.write;
// engineering/automation execution tooling maps onto delivery.write; the reference knowledge base
// maps onto catalog.write.
const PROJECT_ASSIGNED: Record<RouteCapabilityKey, RouteCapabilityDefinition> = {
  "apps/web/src/app/api/actions/[actionKey]/validate/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/playbooks/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/playbooks/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/schedules/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/schedules/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/schedules/tick/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/agent/workflow/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/automation/analyze/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/automation/phase13/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/automation/plan/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/automation/risk/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/automation/skills/recommend/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/automation/skills/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/autopilot/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/commands/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/contacts/[id]/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/contacts/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/customers/[id]/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/customers/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/dev/changes/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/improvements/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/improvements/[id]/run-phase13/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/improvements/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/knowledge/[id]/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/knowledge/route.ts": { capabilityClass: "project-assigned", permission: "catalog.write" },
  "apps/web/src/app/api/mail-candidates/[id]/connect/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-candidates/[id]/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-candidates/batch/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-candidates/cleanup/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-candidates/convert/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-candidates/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-import/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-insight-threads/generate/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-insight-threads/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail-learn/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/mail/calendar-sync/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/modules/[moduleKey]/validate/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/opportunities/[id]/registration/route.ts": { capabilityClass: "project-assigned", permission: "opportunity.write" },
  "apps/web/src/app/api/opportunities/[id]/route.ts": { capabilityClass: "project-assigned", permission: "opportunity.write" },
  "apps/web/src/app/api/opportunities/route.ts": { capabilityClass: "project-assigned", permission: "opportunity.write" },
  "apps/web/src/app/api/partners/[id]/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/partners/route.ts": { capabilityClass: "project-assigned", permission: "customer.write" },
  "apps/web/src/app/api/poc/[id]/route.ts": { capabilityClass: "project-assigned", permission: "poc.write" },
  "apps/web/src/app/api/poc/route.ts": { capabilityClass: "project-assigned", permission: "poc.write" },
  "apps/web/src/app/api/policy-memories/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/projects/[id]/domain-decision/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/projects/[id]/generate/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/proposals/[id]/route.ts": { capabilityClass: "project-assigned", permission: "proposal.write" },
  "apps/web/src/app/api/proposals/route.ts": { capabilityClass: "project-assigned", permission: "proposal.write" },
  "apps/web/src/app/api/renewals/[id]/route.ts": { capabilityClass: "project-assigned", permission: "opportunity.write" },
  "apps/web/src/app/api/tasks/[id]/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/tasks/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/validation/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
  "apps/web/src/app/api/workflows/[commandRunId]/run/route.ts": { capabilityClass: "project-assigned", permission: "delivery.write" },
};

export const ROUTE_CAPABILITY_REGISTRY: Readonly<Record<RouteCapabilityKey, RouteCapabilityDefinition>> = Object.freeze({
  ...PRIVILEGED,
  ...AUTHENTICATED,
  ...PROJECT_ASSIGNED,
  ...POST_U048_GOVERNED,
});

export function getRouteCapabilityDefinition(key: RouteCapabilityKey): RouteCapabilityDefinition | undefined {
  return ROUTE_CAPABILITY_REGISTRY[key];
}

export const ROUTE_CAPABILITY_CLASS_VALUES: readonly RouteCapabilityClass[] = [
  "public",
  "authenticated",
  "company-scoped",
  "project-assigned",
  "owner-assigned",
  "privileged",
  "external-release",
];
