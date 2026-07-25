import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { requireCurrentAiReleaseEvaluation } from "../governance/ai-release-evaluation-service";
import { requireCurrentQuoteVendorReadiness } from "./vendor-request";

export class DeliveryAcceptanceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "DeliveryAcceptanceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export type AcceptDeliveryProjectionCommand = {
  authContext: AuthContext;
  engagementId: string;
  quoteId: string;
  artifactVersionId: string;
  idempotencyKey: string;
  evidenceDetails?: Record<string, unknown>;
};

export type AcceptDeliveryProjectionResult = {
  acceptanceId: string;
  engagementId: string;
  quoteId: string;
  artifactVersionId: string;
  acceptedAt: Date;
  createdAssetsCount: number;
  createdLicensesCount: number;
  createdSubscriptionsCount: number;
  idempotent: boolean;
};

/**
 * Calculates exclusive UTC calendar month anniversary by adding termMonths to startDate.
 * Clamps day-of-month to last valid day of target month if necessary.
 */
export function addUtcTermMonths(startDate: Date, termMonths: number): Date {
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const day = startDate.getUTCDate();
  const hours = startDate.getUTCHours();
  const minutes = startDate.getUTCMinutes();
  const seconds = startDate.getUTCSeconds();
  const ms = startDate.getUTCMilliseconds();

  const targetMonthTotal = month + termMonths;
  const targetYear = year + Math.floor(targetMonthTotal / 12);
  const targetMonth = ((targetMonthTotal % 12) + 12) % 12;

  // Days in target month
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  return new Date(Date.UTC(targetYear, targetMonth, clampedDay, hours, minutes, seconds, ms));
}

export async function acceptDeliveryProjection(
  cmd: AcceptDeliveryProjectionCommand,
): Promise<AcceptDeliveryProjectionResult> {
  if (!cmd.engagementId || !cmd.quoteId || !cmd.artifactVersionId || !cmd.idempotencyKey) {
    throw new DeliveryAcceptanceError("INVALID_COMMAND", "engagementId, quoteId, artifactVersionId, and idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const assignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!assignment) {
      throw new DeliveryAcceptanceError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    const existingAcceptance = await tx.deliveryAcceptance.findFirst({
      where: { idempotencyKey: cmd.idempotencyKey },
    });
    if (existingAcceptance) {
      const assets = await tx.customerAsset.count({ where: { deliveryAcceptanceId: existingAcceptance.id } });
      const licenses = await tx.assetLicense.count({ where: { deliveryAcceptanceId: existingAcceptance.id } });
      const subs = await tx.subscription.count({ where: { deliveryAcceptanceId: existingAcceptance.id } });
      return {
        acceptanceId: existingAcceptance.id,
        engagementId: existingAcceptance.engagementId,
        quoteId: existingAcceptance.quoteId,
        artifactVersionId: existingAcceptance.artifactVersionId,
        acceptedAt: existingAcceptance.acceptedAt,
        createdAssetsCount: assets,
        createdLicensesCount: licenses,
        createdSubscriptionsCount: subs,
        idempotent: true,
      };
    }

    const engagement = await tx.engagement.findUniqueOrThrow({
      where: { id: cmd.engagementId },
    });

    if (!engagement.customerId) {
      throw new DeliveryAcceptanceError("CUSTOMER_REQUIRED", "Engagement missing customerId", 400);
    }

    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: cmd.quoteId },
    });

    if (!quote.contentHash) {
      throw new DeliveryAcceptanceError("QUOTE_HASH_MISSING", "Quote missing contentHash", 400);
    }

    // 1. Revalidate U055 Governed Internal Release
    const relEval = await requireCurrentAiReleaseEvaluation(tx, "quote.internal_release", cmd.artifactVersionId, quote.contentHash);
    if (!relEval.eligible) {
      throw new DeliveryAcceptanceError("RELEASE_NOT_EVALUATED", `Quote internal release blocked: ${relEval.blockers.join(", ")}`, 409);
    }

    // 2. Revalidate U049 Vendor Readiness
    const vendorReadiness = await requireCurrentQuoteVendorReadiness(tx, cmd.quoteId);
    if (!vendorReadiness.eligible) {
      throw new DeliveryAcceptanceError("VENDOR_READINESS_REQUIRED", `Vendor readiness blocked: ${vendorReadiness.blockers.join(", ")}`, 409);
    }

    const acceptedAt = new Date();

    const snapshotData = {
      schemaVersion: "delivery-acceptance-snapshot/v1",
      engagementId: cmd.engagementId,
      quoteId: cmd.quoteId,
      artifactVersionId: cmd.artifactVersionId,
      acceptedAt: acceptedAt.toISOString(),
      evidenceDetails: cmd.evidenceDetails ?? {},
    };
    const acceptanceHash = sha256Hex(canonicalizeRfc8785(snapshotData));

    const acceptance = await tx.deliveryAcceptance.create({
      data: {
        engagementId: cmd.engagementId,
        quoteId: cmd.quoteId,
        artifactVersionId: cmd.artifactVersionId,
        acceptedByAssignmentId: assignment.id,
        acceptedAt,
        acceptanceHash,
        snapshotJson: snapshotData as any,
        idempotencyKey: cmd.idempotencyKey,
      },
    });

    const quoteLines = await tx.quoteLineItem.findMany({
      where: { quoteId: cmd.quoteId },
    });

    let createdAssetsCount = 0;
    let createdLicensesCount = 0;
    let createdSubscriptionsCount = 0;

    for (const line of quoteLines) {
      // Decode or extract fulfillment attributes
      const lineType = line.lineType ?? (line.skuId ? "product" : "service");
      if (lineType === "service") {
        // Service line: no Asset, License, or Subscription created
        continue;
      }

      const termMonths = line.termMonths ?? 0;
      const assetType = termMonths > 0 ? "subscription_product" : "perpetual_product";
      const assetName = `${line.productFamilyKey ?? "default-family"}/${line.productEditionKey ?? "default-edition"}/${line.skuCode ?? "default-sku"}`;

      const asset = await tx.customerAsset.create({
        data: {
          customerId: engagement.customerId,
          assetType,
          name: assetName,
          deliveryAcceptanceId: acceptance.id,
          sourceQuoteLineItemId: line.id,
          productFamilyId: line.productFamilyId ?? "fam-default",
          productSkuId: line.skuId ?? "sku-default",
          installedAt: acceptedAt,
        },
      });
      createdAssetsCount++;

      let assetLicenseId: string | null = null;
      if (line.licenseMetricKey) {
        const lic = await tx.assetLicense.create({
          data: {
            assetId: asset.id,
            skuId: line.skuId ?? "sku-default",
            deliveryAcceptanceId: acceptance.id,
            sourceQuoteLineItemId: line.id,
            licenseMetricKey: line.licenseMetricKey,
            licensedQuantity: Number(line.quantityDecimal ?? 1),
          },
        });
        assetLicenseId = lic.id;
        createdLicensesCount++;
      }

      if (termMonths > 0) {
        const endDate = addUtcTermMonths(acceptedAt, termMonths);
        await tx.subscription.create({
          data: {
            assetId: asset.id,
            skuId: line.skuId ?? "sku-default",
            startDate: acceptedAt,
            endDate,
            deliveryAcceptanceId: acceptance.id,
            assetLicenseId,
            sourceQuoteLineItemId: line.id,
          },
        });
        createdSubscriptionsCount++;
      }
    }

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: "delivery.accepted",
      actorId: ctx.userId,
      resourceType: "delivery_acceptance",
      resourceId: acceptance.id,
      details: {
        engagementId: cmd.engagementId,
        quoteId: cmd.quoteId,
        createdAssetsCount,
        createdLicensesCount,
        createdSubscriptionsCount,
      },
      idempotencyKey: cmd.idempotencyKey,
    });

    return {
      acceptanceId: acceptance.id,
      engagementId: cmd.engagementId,
      quoteId: cmd.quoteId,
      artifactVersionId: cmd.artifactVersionId,
      acceptedAt,
      createdAssetsCount,
      createdLicensesCount,
      createdSubscriptionsCount,
      idempotent: false,
    };
  });
}
