import { z } from "zod";

const source = z.string().max(2_048).url().refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.href.includes("?") && !url.href.includes("#")
      && (url.hostname === "sangfor.com" || url.hostname.endsWith(".sangfor.com")) && url.hostname !== "one.sangfor.com"
      && !/(?:^|\/)(?:portal|login|authenticate|oauth)(?:\/|$)/iu.test(decodeURIComponent(url.pathname))
      && !/넥시아스|nexias|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]/iu.test(decodeURIComponent(value));
  } catch { return false; }
});

/** Validate the complete read-only preview before putting API data into the UI. */
export const supportReplyPreviewSchema = z.object({
  status: z.enum(["draft", "needs_evidence", "conflict", "service_unavailable"]),
  draftText: z.string().max(16_000).nullable(),
  citations: z.array(z.object({
    chunkId: z.string().min(1).max(512), source,
    title: z.string().min(1).max(1_000), section: z.string().max(1_000).optional(),
    product: z.string().min(1).max(100), version: z.string().max(100).optional(),
    quote: z.string().min(1).max(800), quoteStart: z.number().int().nonnegative(),
    textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).max(3),
  missingFacts: z.array(z.string().max(1_000)).max(20),
  warnings: z.array(z.string().max(1_000)).max(20),
  humanReviewRequired: z.literal(true),
  customerSendAllowed: z.literal(false),
  caseRevision: z.number().int().nonnegative().optional(),
});
