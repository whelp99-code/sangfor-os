import { z } from "zod";

const reviewStatusSchema = z.enum(["approved", "proposed", "excluded"]);

const sourceArtifactSchema = z.object({
  artifactId: z.string().min(1),
  fileName: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceType: z.enum([
    "sales_tax_invoice",
    "purchase_tax_invoice",
    "bank_transaction",
    "project_folder",
    "purchase_order",
    "sales_ledger",
    "renewal_ledger",
    "final_pdf",
  ]),
});

const entitySchema = z.object({
  entityKey: z.string().min(1),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  domain: z.string().min(1).optional(),
  businessNumber: z.string().min(1).optional(),
  reviewStatus: reviewStatusSchema,
});

const relationshipSchema = z.object({
  relationshipKey: z.string().min(1),
  businessProject: z.string().min(1),
  subjectEntityKey: z.string().min(1),
  role: z.enum([
    "end_customer",
    "direct_customer",
    "channel_partner",
    "supplier",
    "distributor",
    "billed_counterparty",
  ]),
  counterpartyEntityKey: z.string().min(1).optional(),
  endCustomerEntityKey: z.string().min(1).optional(),
  product: z.string().min(1).optional(),
  lifecycle: z.enum([
    "active_candidate",
    "completed",
    "postponed",
    "failed",
    "renewal",
    "support",
    "unknown",
  ]),
  evidenceTier: z.enum(["A", "B", "C", "D"]),
  confidence: z.number().int().min(0).max(100),
  reviewStatus: reviewStatusSchema,
  sourceArtifactIds: z.array(z.string().min(1)).min(1),
});

export const mailGroundTruthManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    manifestId: z.string().min(1),
    projectSlug: z.string().min(1),
    sources: z.array(sourceArtifactSchema),
    entities: z.array(entitySchema),
    relationships: z.array(relationshipSchema),
  })
  .superRefine((manifest, context) => {
    const sourceIds = new Set(manifest.sources.map((source) => source.artifactId));
    const entityKeys = new Set(manifest.entities.map((entity) => entity.entityKey));
    if (sourceIds.size !== manifest.sources.length) {
      context.addIssue({ code: "custom", message: "source artifactId values must be unique" });
    }
    if (entityKeys.size !== manifest.entities.length) {
      context.addIssue({ code: "custom", message: "entityKey values must be unique" });
    }
    for (const relationship of manifest.relationships) {
      const referencedEntities = [
        relationship.subjectEntityKey,
        relationship.counterpartyEntityKey,
        relationship.endCustomerEntityKey,
      ].filter((value): value is string => Boolean(value));
      if (referencedEntities.some((key) => !entityKeys.has(key))) {
        context.addIssue({
          code: "custom",
          message: `relationship ${relationship.relationshipKey} references an unknown entity`,
        });
      }
      if (relationship.sourceArtifactIds.some((id) => !sourceIds.has(id))) {
        context.addIssue({
          code: "custom",
          message: `relationship ${relationship.relationshipKey} references unknown evidence`,
        });
      }
    }
  });

export type MailGroundTruthManifest = Readonly<
  z.infer<typeof mailGroundTruthManifestSchema>
>;

export type ExistingProjectRoleMemory = {
  readonly key: string;
  readonly label: string;
  readonly valueJson: unknown;
  readonly source: string;
  readonly confidence: number;
  readonly status: string;
};

export type GroundTruthImportPlan = {
  readonly create: readonly ExistingProjectRoleMemory[];
  readonly update: readonly ExistingProjectRoleMemory[];
  readonly unchanged: readonly ExistingProjectRoleMemory[];
};

export type GroundTruthCandidate = {
  readonly id: string;
  readonly candidateType: string;
  readonly title: string;
  readonly summary: string;
  readonly sourceSender?: string | null;
};

export type GroundTruthReclassificationPlan = {
  readonly changes: readonly {
    readonly id: string;
    readonly title: string;
    readonly from: "customer" | "partner";
    readonly to: "customer" | "partner";
    readonly entityKey: string;
    readonly relationshipKeys: readonly string[];
    readonly evidence: readonly {
      readonly relationshipKey: string;
      readonly businessProject: string;
      readonly role: string;
      readonly evidenceTier: "A" | "B" | "C" | "D";
      readonly sourceArtifactIds: readonly string[];
    }[];
  }[];
  readonly humanReview: readonly {
    readonly id: string;
    readonly entityKey: string;
    readonly reason: "conflicting_project_roles";
  }[];
  readonly unchanged: readonly string[];
  readonly writeOperationsPrevented: number;
};
