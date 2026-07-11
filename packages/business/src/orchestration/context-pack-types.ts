import { z } from "zod";

export const templateKeySchema = z.enum([
  "proposal-prd",
  "poc-experiment-plan",
  "dev-implementation-plan",
  "bugfix-improvement-plan",
  "release-closeout-plan",
]);

export type TemplateKey = z.infer<typeof templateKeySchema>;

export const contextPackSourceEntitySchema = z.enum([
  "opportunity",
  "proposal",
  "poc",
]);

export type ContextPackSectionKey =
  | "opportunity"
  | "proposal"
  | "poc"
  | "customer"
  | "partner"
  | "linkedTasks"
  | "knowledgeCitations";

export type ContextPackSection = {
  key: ContextPackSectionKey;
  title: string;
  empty: boolean;
  content: string;
};

export type ContextPack = {
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  templateKey?: TemplateKey | null;
  sections: ContextPackSection[];
  summaryText: string;
};

export type TemplateRenderOutput = {
  templateKey: TemplateKey;
  title: string;
  bodyMarkdown: string;
  deterministic: true;
};

export const buildContextPackSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  sourceEntityType: contextPackSourceEntitySchema.optional(),
  sourceEntityId: z.string().min(1).optional(),
  templateKey: templateKeySchema.optional(),
  knowledgeQuery: z.string().min(1).optional(),
});
