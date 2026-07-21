import type { RouteCapabilityClass, RouteCapabilityDefinition } from "@sangfor/auth";

/**
 * U015/SEC-02a — the static, canonical classification of every apps/web guarded API entry point
 * (the exact 67-file mechanical coverage set: the union of `assertApiAccess(` and
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
  "apps/web/src/app/api/approvals/route.ts": { capabilityClass: "privileged", permission: "role.manage" },
};

const AUTHENTICATED: Record<RouteCapabilityKey, RouteCapabilityDefinition> = {
  "apps/web/src/app/api/auth/logout/route.ts": { capabilityClass: "authenticated" },
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
