import type { Decimal } from "@prisma/client/runtime/library";

import type { Deal } from "@/components/deals/types";

/**
 * Minimal shape required from a listed opportunity record.
 * Accepts the raw Prisma result (where `amount` is `Decimal | null`) as well as
 * the post-`serializeDecimalAtBoundary` shape (where `amount` becomes `number | null`).
 */
export type SerializedOpportunityForDeal = {
  id: string;
  code?: string | null;
  title: string;
  stage: string;
  probability?: number | null;
  amount?: Decimal | number | null;
  customer?: { name?: string | null } | null;
  partner?: { name?: string | null } | null;
  distributor?: { name?: string | null } | null;
  dealRegistration?: { regStatus?: string | null } | null;
  closeDate?: Date | string | null;
  nextAction?: string | null;
  updatedAt: Date | string;
};

/**
 * Maps a serialized Opportunity (output of `serializeDecimalAtBoundary`) to the
 * shared `Deal` presentation shape used by `/opportunities` (and Task 1.6's `/deals`).
 *
 * Fields not yet sourced from the data model are set to `null` with a TODO marker;
 * they will be filled in the referenced Slice.
 */
export function toDeal(opp: SerializedOpportunityForDeal): Deal {
  return {
    id: opp.id,
    code: opp.code ?? null,
    title: opp.title,
    stage: opp.stage,
    dealStatus: null,   // TODO(slice2): source from opportunity status field
    probability: opp.probability ?? 0,
    amount:
      typeof opp.amount === "number"
        ? opp.amount
        : opp.amount != null
          ? Number(opp.amount)
          : null,
    marginPct: null,    // TODO(slice4): derive from cost/amount
    customer: opp.customer?.name ?? null,
    partner: opp.partner?.name ?? null,
    productLine: null,  // TODO(slice2/5): source from opportunity productLine field
    regStatus: opp.dealRegistration?.regStatus ?? null,
    owner: null,        // TODO(slice2): source from opportunity ownerId
    closeDate: opp.closeDate ? new Date(opp.closeDate).toISOString() : null,
    nextAction: opp.nextAction ?? null,
    updatedAt: new Date(opp.updatedAt).toISOString(),
  };
}
