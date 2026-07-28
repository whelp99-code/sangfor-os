import { createHash, randomUUID } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { Prisma, canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { ArtifactServiceError, createArtifactVersion } from "../governance/artifact-service";
import { appendAuditEvent } from "../governance/audit-db";
import type { ApprovalKernelCaller } from "../governance/approval-kernel";

export class QuoteServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "QuoteServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").toLowerCase();
}

export interface QuoteLineInput {
  lineType: "product" | "service";
  description?: string;
  quantity: number; // positive integer/decimal
  skuId?: string; // required for product
  unitPrice?: number;
  discountPct?: number; // 0..100
  // Service line specific
  sourceServiceLineItemId?: string;
  sourceCostStatus?: string;
  costPrice?: number;
  // Product line specific
  deploymentType?: string;
  supportLevel?: string;
  termMonths?: number;
}

export interface CreateQuoteVersionInput {
  opportunityId: string;
  expectedCurrentQuoteId?: string | null;
  expectedCurrentContentHash?: string | null;
  currency?: string;
  lines: QuoteLineInput[];
}

function kernelCallerFromContext(ctx: AuthContext): ApprovalKernelCaller {
  return {
    userId: ctx.userId,
    sessionId: ctx.sessionId ?? "anonymous",
    scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
    mfaVerifiedAt: null,
  };
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId };
}

export async function createQuoteVersion(ctx: AuthContext, input: CreateQuoteVersionInput) {
  const caller = kernelCallerFromContext(ctx);
  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    // Serialize quote-version creation per opportunity (advisory xact lock, U021 pattern) so the
    // read→CAS→insert chain has exactly one winner even for the first-ever quote version.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${"quote:" + input.opportunityId}, 0))`
    );

    // 1. Scope-local opportunity read: opaque foreign ID is 404, no global existence probe
    const opportunity = await tx.opportunity.findFirst({
      where: { id: input.opportunityId, projectId: ctx.projectId },
    });

    if (!opportunity) {
      throw new QuoteServiceError("NOT_FOUND", "Opportunity not found", 404);
    }

    // 2. Verify U045 Deal Qualification passing state (current non-legacy bant-tf-v1)
    const qualification = await tx.dealQualification.findFirst({
      where: { opportunityId: input.opportunityId },
      orderBy: { updatedAt: "desc" },
    });

    if (!qualification || !qualification.passed || qualification.scoringVersion !== "bant-tf-v1") {
      throw new QuoteServiceError(
        "QUALIFICATION_REQUIRED",
        "Opportunity qualification is missing or has not passed",
        422
      );
    }

    // 3. Expected Current Quote CAS verification
    let latestQuote = await tx.quote.findFirst({
      where: { opportunityId: input.opportunityId },
      orderBy: { version: "desc" },
    });

    if (input.expectedCurrentQuoteId !== undefined) {
      const currentId = latestQuote?.id ?? null;
      if (input.expectedCurrentQuoteId !== currentId) {
        throw new QuoteServiceError(
          "STALE_CAS",
          `Expected current quote ID ${input.expectedCurrentQuoteId} does not match latest ${currentId}`,
          409
        );
      }
    }

    if (input.expectedCurrentContentHash !== undefined && latestQuote) {
      if (input.expectedCurrentContentHash !== latestQuote.contentHash) {
        throw new QuoteServiceError(
          "STALE_CAS",
          `Expected current content hash mismatch`,
          409
        );
      }
    }

    const nextVersionNumber = (latestQuote?.version ?? 0) + 1;
    const currency = input.currency || latestQuote?.currency || "USD";

    // 4. Process Line Items and Calculate Money
    if (!input.lines || input.lines.length === 0) {
      throw new QuoteServiceError("LINES_REQUIRED", "At least one quote line item is required", 400);
    }

    let totalRevenueDec = new Prisma.Decimal(0);
    let totalCostDec = new Prisma.Decimal(0);
    let hasMissingCost = false;

    const preparedLines: Array<{
      id: string;
      lineType: string;
      description?: string;
      quantityDecimal: Prisma.Decimal;
      quantityDecimalCanonical: string;
      quantityInt: number;
      unitPriceDec: Prisma.Decimal;
      costPriceDec: Prisma.Decimal;
      discountPctDec: Prisma.Decimal;
      revenueDec: Prisma.Decimal;
      costDec: Prisma.Decimal;
      marginPctDec: Prisma.Decimal;
      currency: string;
      skuId: string | null;
      skuCode: string | null;
      productFamilyId: string | null;
      productFamilyKey: string | null;
      productEditionId: string | null;
      productEditionKey: string | null;
      termMonths: number | null;
      licenseMetricId: string | null;
      licenseMetricKey: string | null;
      licenseMetricSnapshotHash: string | null;
      deploymentType: string | null;
      supportLevel: string | null;
      fulfillmentKind: string;
      catalogSnapshotVersion: string | null;
      catalogSnapshotHash: string | null;
      sizingArtifactVersionId: string | null;
      sizingArtifactVersionContentHash: string | null;
      compatibilityArtifactVersionIds: string[] | null;
      compatibilityArtifactVersionContentHashes: string[] | null;
      fulfillmentSnapshot: Record<string, unknown>;
      fulfillmentSnapshotHash: string;
      sourceServiceLineItemId: string | null;
      sourceCostStatus: string | null;
    }> = [];

    for (const rawLine of input.lines) {
      if (rawLine.quantity <= 0) {
        throw new QuoteServiceError("INVALID_QUANTITY", "Line quantity must be positive", 400);
      }

      const qtyDec = new Prisma.Decimal(rawLine.quantity);
      const qtyInt = Math.floor(rawLine.quantity);
      const discountPctDec = new Prisma.Decimal(rawLine.discountPct ?? 0);

      if (discountPctDec.lessThan(0) || discountPctDec.greaterThan(100)) {
        throw new QuoteServiceError("INVALID_DISCOUNT", "Discount percentage must be between 0 and 100", 400);
      }

      if (rawLine.lineType === "service") {
        const unitPriceDec = new Prisma.Decimal(rawLine.unitPrice ?? 0);
        const costPriceDec = new Prisma.Decimal(rawLine.costPrice ?? 0);

        // U035 contract: sourceCostStatus must be non-null for service_only lines
        // Use caller-supplied value, or default to "authorized" (costPrice provided) / "missing" (no costPrice)
        const hasCost = rawLine.costPrice !== undefined && rawLine.costPrice !== null;
        const resolvedSourceCostStatus = rawLine.sourceCostStatus ?? (hasCost ? "authorized" : "missing");

        if (resolvedSourceCostStatus === "missing" || !hasCost) {
          hasMissingCost = true;
        }

        const revDec = qtyDec.mul(unitPriceDec).mul(new Prisma.Decimal(1).sub(discountPctDec.div(100))).toDecimalPlaces(2);
        const costDec = qtyDec.mul(costPriceDec).toDecimalPlaces(2);
        const marginAmtDec = revDec.sub(costDec);
        const marginPctDec = revDec.greaterThan(0) ? marginAmtDec.div(revDec).mul(100).toDecimalPlaces(2) : new Prisma.Decimal(0);

        totalRevenueDec = totalRevenueDec.add(revDec);
        totalCostDec = totalCostDec.add(costDec);

        // Pre-generate line ID for fulfillmentSnapshot source section
        const lineId = randomUUID();
        // Canonical quantityDecimal: trim trailing zeros and decimals
        const quantityDecimalCanonical = qtyDec.toString().replace(/\.?0+$/, '');

        const fulfillmentSnapshot = {
          schemaVersion: "quote-line-fulfillment/v1",
          source: {
            quoteId: "PENDING_QUOTE_ID", // Will be filled on INSERT
            quoteLineItemId: lineId,     // Pre-generated; U035 trigger expects actual value
            lineType: "service",
            skuId: null,
            sourceServiceLineItemId: rawLine.sourceServiceLineItemId ?? null,
            sourceCostStatus: resolvedSourceCostStatus, // Non-null per U035 contract
          },
          quantity: {
            quantityDecimal: quantityDecimalCanonical,
            currency: currency,
          },
          catalog: {
            catalogSnapshotVersion: null,
            catalogSnapshotHash: null,
            productFamilyId: null,
            productFamilyKey: null,
            productEditionId: null,
            productEditionKey: null,
            skuId: null,
            skuCode: null,
          },
          license: {
            licenseMetricId: null,
            licenseMetricKey: null,
            licenseMetricSnapshotHash: null,
            termMonths: null,
          },
          deployment: {
            deploymentType: null,
            supportLevel: null,
            fulfillmentKind: "service_only",
          },
          rules: {
            sizingArtifactVersionId: null,
            sizingArtifactVersionContentHash: null,
            compatibilityArtifactVersionIds: null,
            compatibilityArtifactVersionContentHashes: null,
          },
        };

        const fulfillmentSnapshotHash = sha256Hex(canonicalizeRfc8785(fulfillmentSnapshot));

        preparedLines.push({
          id: lineId,
          lineType: "service",
          description: rawLine.description,
          quantityDecimal: qtyDec,
          quantityDecimalCanonical,
          quantityInt: qtyInt,
          unitPriceDec,
          costPriceDec,
          discountPctDec,
          revenueDec: revDec,
          costDec,
          marginPctDec,
          currency,
          skuId: null,
          skuCode: null,
          productFamilyId: null,
          productFamilyKey: null,
          productEditionId: null,
          productEditionKey: null,
          termMonths: null,
          licenseMetricId: null,
          licenseMetricKey: null,
          licenseMetricSnapshotHash: null,
          deploymentType: null, // Service lines have no deployment info in typed columns
          supportLevel: null,   // Service lines have no deployment info in typed columns
          fulfillmentKind: "service_only",
          catalogSnapshotVersion: null,
          catalogSnapshotHash: null,
          sizingArtifactVersionId: null,
          sizingArtifactVersionContentHash: null,
          compatibilityArtifactVersionIds: null,
          compatibilityArtifactVersionContentHashes: null,
          fulfillmentSnapshot,
          fulfillmentSnapshotHash,
          sourceServiceLineItemId: rawLine.sourceServiceLineItemId ?? null,
          sourceCostStatus: resolvedSourceCostStatus, // Non-null per U035 contract
        });
      } else if (rawLine.lineType === "product") {
        if (!rawLine.skuId) {
          throw new QuoteServiceError("SKU_REQUIRED", "Product line requires skuId", 400);
        }

        const sku = await tx.productSku.findUnique({
          where: { id: rawLine.skuId },
          include: {
            edition: {
              include: {
                family: true,
              },
            },
          },
        });

        if (!sku || sku.status !== "active") {
          throw new QuoteServiceError("SKU_INACTIVE", `SKU ${rawLine.skuId} is inactive or non-existent`, 400);
        }

        if (sku.edition.family.companyId !== caller.scope.companyId) {
          throw new QuoteServiceError("FORBIDDEN", "Foreign company SKU selection forbidden", 403);
        }

        // Fetch U046 Active Sizing Template and Active Compatibility Rules
        const sizingTemplate = await tx.sizingTemplate.findFirst({
          where: { productFamilyId: sku.edition.family.id, status: "ACTIVE" },
          include: { activeArtifactVersion: true },
        });

        if (!sizingTemplate || !sizingTemplate.activeArtifactVersion) {
          throw new QuoteServiceError(
            "ACTIVE_SIZING_RULE_REQUIRED",
            `No active sizing rule version found for product family ${sku.edition.family.id}`,
            422
          );
        }

        const compatRules = await tx.compatibilityRule.findMany({
          where: { sourceSkuId: sku.id, status: "ACTIVE" },
          include: { activeArtifactVersion: true },
          orderBy: { id: "asc" },
        });

        const compatIds: string[] = [];
        const compatHashes: string[] = [];

        for (const rule of compatRules) {
          if (rule.activeArtifactVersion) {
            compatIds.push(rule.activeArtifactVersion.id);
            compatHashes.push(rule.activeArtifactVersion.contentHash);
          }
        }

        // Sort compatibility arrays ascending by ID
        const compatPairs = compatIds.map((id, idx) => ({ id, hash: compatHashes[idx] }));
        compatPairs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const sortedCompatIds = compatPairs.map((p) => p.id);
        const sortedCompatHashes = compatPairs.map((p) => p.hash);

        // U035 contract: product lines require nonempty compatibility arrays (fail-closed)
        if (sortedCompatIds.length === 0) {
          throw new QuoteServiceError(
            "COMPATIBILITY_REQUIRED",
            `No active compatibility rules found for SKU ${sku.id}; product lines require at least one compatibility artifact`,
            422
          );
        }

        // Fetch License Metric if associated
        const metric = await tx.licenseMetric.findFirst({
          where: { productFamilyId: sku.edition.family.id },
        });

        const unitPriceDec = new Prisma.Decimal(rawLine.unitPrice ?? sku.unitPrice ?? 0);
        const costPriceDec = new Prisma.Decimal(rawLine.costPrice ?? sku.unitCost ?? 0);

        const revDec = qtyDec.mul(unitPriceDec).mul(new Prisma.Decimal(1).sub(discountPctDec.div(100))).toDecimalPlaces(2);
        const costDec = qtyDec.mul(costPriceDec).toDecimalPlaces(2);
        const marginAmtDec = revDec.sub(costDec);
        const marginPctDec = revDec.greaterThan(0) ? marginAmtDec.div(revDec).mul(100).toDecimalPlaces(2) : new Prisma.Decimal(0);

        totalRevenueDec = totalRevenueDec.add(revDec);
        totalCostDec = totalCostDec.add(costDec);

        const fulfillmentKind = rawLine.termMonths ? "subscription_product" : "perpetual_product";

        // Pre-generate line ID
        const lineId = randomUUID();
        // Canonical quantityDecimal
        const quantityDecimalCanonical = qtyDec.toString().replace(/\.?0+$/, '');

        const catalogSnapshotObj = {
          catalogSnapshotVersion: "quote-line-catalog/v1",
          productFamilyId: sku.edition.family.id,
          productFamilyKey: sku.edition.family.familyKey,
          productEditionId: sku.edition.id,
          productEditionKey: sku.edition.editionKey,
          skuId: sku.id,
          skuCode: sku.skuCode,
        };

        const catalogSnapshotHash = sha256Hex(canonicalizeRfc8785(catalogSnapshotObj));

        const fulfillmentSnapshot = {
          schemaVersion: "quote-line-fulfillment/v1",
          source: {
            quoteId: "PENDING_QUOTE_ID", // Will be filled on INSERT
            quoteLineItemId: lineId,     // Pre-generated
            lineType: "product",
            skuId: sku.id,
            sourceServiceLineItemId: null,
            sourceCostStatus: null,
          },
          quantity: {
            quantityDecimal: quantityDecimalCanonical,
            currency: currency,
          },
          catalog: {
            catalogSnapshotVersion: "quote-line-catalog/v1",
            catalogSnapshotHash: catalogSnapshotHash, // catalogSnapshotHash within snapshot JSON, not as typed column
            productFamilyId: sku.edition.family.id,
            productFamilyKey: sku.edition.family.familyKey,
            productEditionId: sku.edition.id,
            productEditionKey: sku.edition.editionKey,
            skuId: sku.id,
            skuCode: sku.skuCode,
          },
          license: {
            licenseMetricId: metric?.id ?? null,
            licenseMetricKey: metric?.key ?? null,
            licenseMetricSnapshotHash: metric ? sha256Hex(canonicalizeRfc8785({ id: metric.id, key: metric.key, name: metric.name })) : null,
            termMonths: rawLine.termMonths ?? null,
          },
          deployment: {
            deploymentType: rawLine.deploymentType ?? "on_premise",
            supportLevel: rawLine.supportLevel ?? "standard",
            fulfillmentKind: fulfillmentKind,
          },
          rules: {
            sizingArtifactVersionId: sizingTemplate.activeArtifactVersion.id,
            sizingArtifactVersionContentHash: sizingTemplate.activeArtifactVersion.contentHash,
            compatibilityArtifactVersionIds: sortedCompatIds,
            compatibilityArtifactVersionContentHashes: sortedCompatHashes,
          },
        };

        const fulfillmentSnapshotHash = sha256Hex(canonicalizeRfc8785(fulfillmentSnapshot));

        preparedLines.push({
          id: lineId,
          lineType: "product",
          description: rawLine.description ?? sku.name,
          quantityDecimal: qtyDec,
          quantityDecimalCanonical,
          quantityInt: qtyInt,
          unitPriceDec,
          costPriceDec,
          discountPctDec,
          revenueDec: revDec,
          costDec,
          marginPctDec,
          currency,
          skuId: sku.id,
          skuCode: sku.skuCode,
          productFamilyId: sku.edition.family.id,
          productFamilyKey: sku.edition.family.familyKey,
          productEditionId: sku.edition.id,
          productEditionKey: sku.edition.editionKey,
          termMonths: rawLine.termMonths ?? null,
          licenseMetricId: metric?.id ?? null,
          licenseMetricKey: metric?.key ?? null,
          licenseMetricSnapshotHash: metric ? sha256Hex(canonicalizeRfc8785({ id: metric.id, key: metric.key, name: metric.name })) : null,
          deploymentType: rawLine.deploymentType ?? "on_premise",
          supportLevel: rawLine.supportLevel ?? "standard",
          fulfillmentKind,
          catalogSnapshotVersion: "quote-line-catalog/v1",
          catalogSnapshotHash,
          sizingArtifactVersionId: sizingTemplate.activeArtifactVersion.id,
          sizingArtifactVersionContentHash: sizingTemplate.activeArtifactVersion.contentHash,
          compatibilityArtifactVersionIds: sortedCompatIds,
          compatibilityArtifactVersionContentHashes: sortedCompatHashes,
          fulfillmentSnapshot,
          fulfillmentSnapshotHash,
          sourceServiceLineItemId: null,
          sourceCostStatus: null,
        });
      }
    }

    const totalMarginDec = totalRevenueDec.sub(totalCostDec);
    const overallMarginPctDec = totalRevenueDec.greaterThan(0)
      ? totalMarginDec.div(totalRevenueDec).mul(100).toDecimalPlaces(2)
      : new Prisma.Decimal(0);

    const costCoverageStatus = hasMissingCost ? "auto_failed" : "complete";
    const requiresApproval = hasMissingCost || overallMarginPctDec.lessThan(15);

    // 5. Resolve one stable quote Artifact per opportunity lineage (U023 expected-current CAS
    // makes concurrent successors single-winner); a fresh Artifact only for the first version.
    const userAssignment = await tx.userCompanyRole.findFirst({
      where: {
        userId: caller.userId,
        companyId: caller.scope.companyId,
        status: "active",
      },
    });

    if (!userAssignment) {
      throw new QuoteServiceError(
        "NO_ASSIGNMENT",
        "Caller has no active assignment in the target company",
        403
      );
    }

    let artifactId: string;
    let expectedCurrentVersionId: string | null = null;
    let expectedCurrentRevision = 0;
    if (latestQuote?.artifactVersionId) {
      const prevVersion = await tx.artifactVersion.findUnique({
        where: { id: latestQuote.artifactVersionId },
        select: { artifactId: true },
      });
      if (!prevVersion) {
        throw new QuoteServiceError("ARTIFACT_LINK_BROKEN", "Predecessor quote artifact version missing", 500);
      }
      const artifactRow = await tx.artifact.findUniqueOrThrow({
        where: { id: prevVersion.artifactId },
        select: { id: true, currentVersionId: true, currentRevision: true },
      });
      artifactId = artifactRow.id;
      expectedCurrentVersionId = artifactRow.currentVersionId;
      expectedCurrentRevision = artifactRow.currentRevision;
    } else {
      const artifact = await tx.artifact.create({
        data: {
          tenantId: caller.scope.tenantId,
          companyId: caller.scope.companyId,
          projectId: opportunity.projectId,
          title: `Quote — ${opportunity.title}`,
          artifactType: "quote_document",
          classification: "internal",
          origin: "human",
          createdByAssignmentId: userAssignment.id,
          ownerAssignmentId: userAssignment.id,
        },
      });
      artifactId = artifact.id;
    }

    const quoteContentPayload = {
      opportunityId: opportunity.id,
      version: nextVersionNumber,
      currency,
      totalRevenue: totalRevenueDec.toString(),
      totalCost: totalCostDec.toString(),
      marginPct: overallMarginPctDec.toString(),
      costCoverageStatus,
      requiresApproval,
      lines: preparedLines.map((l) => ({
        lineType: l.lineType,
        quantity: l.quantityDecimal.toString(),
        revenue: l.revenueDec.toString(),
        cost: l.costDec.toString(),
        fulfillmentSnapshotHash: l.fulfillmentSnapshotHash,
      })),
    };

    let artifactVersion;
    try {
      artifactVersion = await createArtifactVersion(
        {
          artifactId,
          expectedCurrentVersionId,
          expectedCurrentRevision,
          content: JSON.stringify(quoteContentPayload),
          contentType: "application/json",
        },
        caller,
        tx
      );
    } catch (err) {
      if (err instanceof ArtifactServiceError && err.code === "STALE_CURRENT") {
        throw new QuoteServiceError("STALE_CAS", "Concurrent quote version lost the current-version CAS", 409);
      }
      throw err;
    }

    const contentHash = sha256Hex(canonicalizeRfc8785(quoteContentPayload));

    // 6. Create Quote Row with pre-generated ID
    const quoteId = randomUUID();
    const createdQuote = await tx.quote.create({
      data: {
        id: quoteId,
        opportunityId: opportunity.id,
        companyId: caller.scope.companyId,
        status: "draft",
        version: nextVersionNumber,
        totalRevenue: totalRevenueDec,
        totalCost: totalCostDec,
        marginPct: overallMarginPctDec,
        createdBy: caller.userId,
        supersedesQuoteId: latestQuote?.id ?? null,
        contentHash: contentHash,
        currency: currency,
        artifactVersionId: artifactVersion.versionId,
      },
    });

    // 7. Create Line Items with pre-computed fulfillmentSnapshot (quoteId + lineId already in snapshot.source)
    for (const prepared of preparedLines) {
      // Update fulfillmentSnapshot source with actual quote ID
      const snapObj = prepared.fulfillmentSnapshot as any;
      snapObj.source.quoteId = createdQuote.id;
      // lineItemId already set in preparedLines[i].id

      await tx.quoteLineItem.create({
        data: {
          id: prepared.id,
          quoteId: createdQuote.id,
          skuId: prepared.skuId,
          quantity: prepared.quantityInt,
          unitPrice: prepared.unitPriceDec,
          costPrice: prepared.costPriceDec,
          discountPct: prepared.discountPctDec,
          revenue: prepared.revenueDec,
          cost: prepared.costDec,
          marginPct: prepared.marginPctDec,
          lineType: prepared.lineType,
          description: prepared.description,
          quantityDecimal: prepared.quantityDecimal,
          currency: prepared.currency,
          sourceServiceLineItemId: prepared.sourceServiceLineItemId,
          sourceCostStatus: prepared.sourceCostStatus,
          productFamilyId: prepared.productFamilyId,
          productFamilyKey: prepared.productFamilyKey,
          productEditionId: prepared.productEditionId,
          productEditionKey: prepared.productEditionKey,
          skuCode: prepared.skuCode,
          termMonths: prepared.termMonths,
          licenseMetricId: prepared.licenseMetricId,
          licenseMetricKey: prepared.licenseMetricKey,
          licenseMetricSnapshotHash: prepared.licenseMetricSnapshotHash,
          deploymentType: prepared.deploymentType,
          supportLevel: prepared.supportLevel,
          fulfillmentKind: prepared.fulfillmentKind,
          catalogSnapshotVersion: prepared.catalogSnapshotVersion,
          // catalogSnapshotHash: NULL on INSERT; U035 trigger computes it from snapshot
          sizingArtifactVersionId: prepared.sizingArtifactVersionId,
          sizingArtifactVersionContentHash: prepared.sizingArtifactVersionContentHash,
          ...(prepared.compatibilityArtifactVersionIds !== null
            ? { compatibilityArtifactVersionIds: prepared.compatibilityArtifactVersionIds as any }
            : {}),
          ...(prepared.compatibilityArtifactVersionContentHashes !== null
            ? { compatibilityArtifactVersionContentHashes: prepared.compatibilityArtifactVersionContentHashes as any }
            : {}),
          fulfillmentSnapshot: snapObj,
          // fulfillmentSnapshotHash: NULL on INSERT; U035 trigger computes it from snapshot
        },
      });
    }

    // 8. Create QuoteCommercialSnapshot
    const commercialSnapshotPayload = {
      quoteId: createdQuote.id,
      policyVersion: "v1",
      thresholdMarginPct: "15.00",
      calculatedRevenue: totalRevenueDec.toString(),
      calculatedCost: totalCostDec.toString(),
      calculatedMarginPct: overallMarginPctDec.toString(),
      costCoverageStatus,
      requiresApproval,
    };

    const snapshotHash = sha256Hex(canonicalizeRfc8785(commercialSnapshotPayload));

    await tx.quoteCommercialSnapshot.create({
      data: {
        quoteId: createdQuote.id,
        policyVersion: "v1",
        thresholdMarginPct: new Prisma.Decimal(15),
        calculatedRevenue: totalRevenueDec,
        calculatedCost: totalCostDec,
        calculatedMarginPct: overallMarginPctDec,
        costCoverageStatus,
        requiresApproval,
        snapshotHash,
      },
    });

    // 9. Append Audit Event
    await appendAuditEvent(tx, {
      scope: {
        tenantId: caller.scope.tenantId,
        companyId: caller.scope.companyId,
        projectId: opportunity.projectId,
        level: "PROJECT",
      },
      eventType: "quote.version_created",
      actorId: caller.userId,
      resourceType: "Quote",
      resourceId: createdQuote.id,
      details: {
        version: nextVersionNumber,
        supersedesQuoteId: latestQuote?.id ?? null,
        contentHash,
        totalRevenue: totalRevenueDec.toString(),
        totalCost: totalCostDec.toString(),
        marginPct: overallMarginPctDec.toString(),
        costCoverageStatus,
        requiresApproval,
      },
    });

    return await tx.quote.findUniqueOrThrow({
      where: { id: createdQuote.id },
      include: {
        lineItems: true,
        commercialSnapshot: true,
        artifactVersion: true,
      },
    });
  });
}

export async function getQuoteDetail(ctx: AuthContext, quoteId: string) {
  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const quote = await tx.quote.findFirst({
      where: { id: quoteId, companyId: ctx.companyId },
      include: {
        lineItems: true,
        commercialSnapshot: true,
        artifactVersion: true,
      },
    });
    if (!quote) {
      throw new QuoteServiceError("NOT_FOUND", "Quote not found", 404);
    }
    return quote;
  });
}

export async function listQuoteVersions(
  ctx: AuthContext,
  opportunityId: string,
  options?: { first?: number }
) {
  const take = Math.min(Math.max(options?.first ?? 50, 1), 100);
  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const opportunity = await tx.opportunity.findFirst({
      where: { id: opportunityId, projectId: ctx.projectId },
      select: { id: true },
    });
    if (!opportunity) {
      throw new QuoteServiceError("NOT_FOUND", "Opportunity not found", 404);
    }
    return tx.quote.findMany({
      where: { opportunityId },
      orderBy: { version: "desc" },
      take,
      include: { commercialSnapshot: true },
    });
  });
}
