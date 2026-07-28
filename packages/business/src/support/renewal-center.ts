import type { AuthContext } from "@sangfor/auth";
import {
  getScopedRenewalDetail,
  updateRenewalLifecycle,
  type RenewalLifecycleStatus,
} from "./renewal-projection";

export async function getScopedRenewalCenterDetail(
  authContext: AuthContext,
  renewalOpportunityId: string,
) {
  return getScopedRenewalDetail({ authContext, renewalOpportunityId });
}

export async function updateRenewalCenterLifecycle(
  authContext: AuthContext,
  renewalOpportunityId: string,
  expectedStatus: RenewalLifecycleStatus,
  expectedUpdatedAt: string | Date,
  nextStatus: RenewalLifecycleStatus,
  notes: string | null | undefined,
  idempotencyKey: string,
  now: Date,
) {
  return updateRenewalLifecycle({
    authContext,
    renewalOpportunityId,
    expectedStatus,
    expectedUpdatedAt,
    nextStatus,
    notes,
    idempotencyKey,
    now,
  });
}
