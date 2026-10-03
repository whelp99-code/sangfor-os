import { createHash } from "node:crypto";
import { z } from "zod";

const bounded = (max: number) => z.string().trim().min(1).max(max);
export const supportReplyRequestSchema = z.object({
  topic: z.enum(["renewal", "service_letter", "kernel_patch", "general"]),
  query: bounded(2_000),
  product: bounded(100),
  version: bounded(100).optional(),
}).strict();

export type SupportReplyRequest = z.infer<typeof supportReplyRequestSchema>;

/** Structural input seam: the business package never imports the infra client. */
export interface SupportReplyEvidenceHit {
  id?: string;
  title?: string;
  section?: string;
  text?: string;
  source?: string;
  product?: string;
  version?: string;
  trustLevel?: string;
  sourceVisibility?: string;
  customerShareable?: boolean;
  textSha256?: string;
}

export interface SupportReplySearch {
  results: readonly SupportReplyEvidenceHit[];
  diagnostics?: { degraded?: boolean; searchMode?: string; evidenceRequirement?: string };
}

export interface SupportReplyCitation {
  chunkId: string;
  source: string;
  title: string;
  section?: string;
  product: string;
  version?: string;
  quote: string;
  quoteStart: number;
  textSha256: string;
}

export interface SupportReplyDraft {
  status: "draft" | "needs_evidence" | "conflict" | "service_unavailable";
  draftText: string | null;
  citations: SupportReplyCitation[];
  missingFacts: string[];
  warnings: string[];
  humanReviewRequired: true;
  customerSendAllowed: false;
}

const WARNINGS = [
  "검토용 초안입니다. 발송·승인·학습·장비 작업은 수행하지 않습니다.",
  "문서 인용은 현재 장비 상태, 계약 조건 또는 패치 적용 가능 여부를 증명하지 않습니다.",
  "자료의 최신성 및 질문과의 의미적 관련성은 사람이 원문에서 확인해야 합니다.",
];

function result(status: SupportReplyDraft["status"], missingFacts: string[], draftText: string | null = null): SupportReplyDraft {
  return { status, draftText, citations: [], missingFacts, warnings: [...WARNINGS], humanReviewRequired: true, customerSendAllowed: false };
}

const PRIVATE_COPY_MARKER = /넥시아스|nexias|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]/iu;

/** URL safety only. Public visibility must be independently recorded by the source curator. */
export function isSafeSangforDocumentLink(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.href.includes("?") && !url.href.includes("#")
      && (url.hostname === "sangfor.com" || url.hostname.endsWith(".sangfor.com"))
      && url.hostname !== "one.sangfor.com"
      && !/(?:^|\/)(?:portal|login|authenticate|oauth)(?:\/|$)/iu.test(decodeURIComponent(url.pathname))
      && !PRIVATE_COPY_MARKER.test(decodeURIComponent(source));
  } catch { return false; }
}

/**
 * Deterministic, extractive drafting only. Retrieval text is quoted as data, never
 * interpreted as instructions. No LLM, database, approved outcome, or memory write.
 * A source hash proves exact capture, not semantic correctness or vendor approval.
 */
export function buildSupportReplyDraft(input: SupportReplyRequest, search: SupportReplySearch): SupportReplyDraft {
  const request = supportReplyRequestSchema.parse(input);
  if (request.topic === "renewal") {
    return result("needs_evidence", ["장비 식별정보", "만료일과 요청 기간", "승인된 최신 견적·계약 근거"],
      "안녕하세요.\n갱신 조건 확인을 위해 장비 식별정보, 만료일, 요청 기간 및 승인된 최신 견적·계약 자료를 공유 부탁드립니다.\n감사합니다.");
  }
  if (request.topic === "service_letter") {
    return result("needs_evidence", ["대상 장비와 요청 기간", "발급 상태를 확인할 수 있는 승인된 원본 자료"],
      "안녕하세요.\n서비스레터 확인을 위해 대상 장비, 요청 기간 및 발급 상태를 확인할 수 있는 원본 자료를 공유 부탁드립니다.\n감사합니다.");
  }
  if (request.topic === "kernel_patch" && !request.version) {
    return result("needs_evidence", ["정확한 제품 버전과 패치 식별정보"],
      "안녕하세요.\n커널·패치 관련 확인을 위해 정확한 제품 버전과 패치 식별정보를 공유 부탁드립니다.\n감사합니다.");
  }
  if (search.diagnostics?.evidenceRequirement) {
    return result("needs_evidence", ["현재 장비 상태를 확인할 수 있는 별도 승인된 근거"]);
  }
  if (search.diagnostics?.degraded !== false || !["semantic", "bm25"].includes(search.diagnostics.searchMode ?? "")) {
    return result("needs_evidence", ["검색 상태와 근거 품질 확인"]);
  }
  if (search.results.length > 20) return result("needs_evidence", ["검색 응답 범위 확인"]);

  // Reconcile every identifiable duplicate before filtering. Otherwise a denied,
  // differently versioned, or restricted copy could silently lose to a public one.
  const seen = new Map<string, string>();
  for (const hit of search.results) {
    if (!hit.id || !hit.source || !isSafeSangforDocumentLink(hit.source)) continue;
    const identity = JSON.stringify([new URL(hit.source).href, hit.id]);
    const provenance = JSON.stringify([hit.product?.toUpperCase(), hit.version, hit.text, hit.textSha256,
      hit.trustLevel, hit.sourceVisibility, hit.customerShareable, hit.title, hit.section]);
    if (seen.has(identity) && seen.get(identity) !== provenance) {
      return result("conflict", ["같은 출처·청크의 원문·버전·공유 권한 충돌 확인"]);
    }
    seen.set(identity, provenance);
  }

  const citations: SupportReplyCitation[] = [];
  const selectedIdentities = new Set<string>();
  for (const hit of search.results) {
    if (!hit.id || !hit.text || hit.text.length > 12_000 || !hit.source || !hit.product || !hit.title) continue;
    if (hit.product.toUpperCase() !== request.product.toUpperCase()) continue;
    if (request.version && hit.version !== request.version) continue;
    if (hit.trustLevel !== "official" || hit.sourceVisibility !== "public" || hit.customerShareable !== true
      || !isSafeSangforDocumentLink(hit.source)) continue;
    const hash = createHash("sha256").update(hit.text, "utf8").digest("hex");
    if (hash !== hit.textSha256) return result("conflict", ["인용 원문 무결성 재확인"]);
    const source = new URL(hit.source).href;
    const identity = JSON.stringify([source, hit.id]);
    if (selectedIdentities.has(identity)) continue;
    selectedIdentities.add(identity);
    // Customer-facing copies must not expose an intermediary or private contact data.
    if (PRIVATE_COPY_MARKER.test([hit.id, hit.title, hit.section, hit.product, hit.version, hit.source, hit.text].join("\n"))) continue;
    citations.push({ chunkId: hit.id, source, title: hit.title,
      ...(hit.section ? { section: hit.section } : {}), product: hit.product,
      ...(hit.version ? { version: hit.version } : {}), quote: hit.text.slice(0, 800), quoteStart: 0, textSha256: hash });
  }
  if (!citations.length) return result("needs_evidence", ["제품·버전과 공개·고객 공유 가능 여부가 확인된 공식 원문 자료"]);
  const selected = citations.slice(0, 3);
  const draft = result("draft", [], ["안녕하세요.", "문의 관련 공식 자료에서 찾은 원문을 전달드립니다.",
    ...selected.map((citation, index) => `[${index + 1}] ${citation.title}${citation.version ? ` (${citation.version})` : ""}\n“${citation.quote}”\n${citation.source}`),
    "현재 장비 상태와 적용 가능 여부는 별도 확인이 필요합니다.", "감사합니다."].join("\n\n"));
  draft.citations = selected;
  return draft;
}

export function unavailableSupportReplyDraft(): SupportReplyDraft {
  return result("service_unavailable", ["근거 검색 서비스 연결 확인"]);
}
