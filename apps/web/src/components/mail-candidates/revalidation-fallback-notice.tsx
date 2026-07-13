export function getRevalidationFallbackMessage(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length === 0) return null;

  const normalized = reason.toLowerCase();
  if (/timeout|timed out|abort|시간.*초과/.test(normalized)) {
    return "AI 재검증 응답 시간이 초과되어 규칙 기반 검토로 대체했습니다.";
  }
  if (/429|rate.?limit|quota|요청 한도/.test(normalized)) {
    return "AI 재검증 요청 한도에 도달하여 규칙 기반 검토로 대체했습니다.";
  }
  if (/401|403|auth|api.?key|credential|서비스 인증/.test(normalized)) {
    return "AI 재검증 서비스 인증을 확인할 수 없어 규칙 기반 검토로 대체했습니다.";
  }
  return "AI 재검증 서비스를 사용할 수 없어 규칙 기반 검토로 대체했습니다.";
}

export function getRevalidationDecisionLabel(decision: unknown): string {
  if (decision === "approve_candidate") return "승인 후보";
  if (decision === "needs_human_review") return "사람 검토 필요";
  if (decision === "reject") return "반려";
  if (decision === "knowledge_only") return "지식 전용";
  return "알 수 없음";
}

export function getRevalidationModeLabel(mode: unknown): string {
  if (mode === "llm") return "AI 모델";
  if (mode === "template") return "규칙 기반 대체";
  return "알 수 없음";
}

const DEDICATED_METADATA_KEYS = new Set([
  "aiRevalidation",
  "mailIntelligence",
  "policyDecision",
]);

export function getVisibleMailCandidateMetadataEntries(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(metadata)
    .filter(([key]) => !DEDICATED_METADATA_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      value:
        value && typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value ?? ""),
    }));
}

export function MailCandidateMetadata({ metadata }: { metadata: unknown }) {
  const entries = getVisibleMailCandidateMetadataEntries(metadata);
  if (entries.length === 0) {
    return <p className="text-muted-foreground">표시할 추가 메타데이터가 없습니다.</p>;
  }

  return entries.map((entry) => (
    <div key={entry.key} className="min-w-0 rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{entry.key}</p>
      <p className="break-words font-medium">{entry.value || "—"}</p>
    </div>
  ));
}

export function RevalidationFallbackNotice({ reason }: { reason: unknown }) {
  const message = getRevalidationFallbackMessage(reason);
  if (!message) return null;

  return (
    <div
      role="status"
      className="space-y-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-base text-red-800 sm:text-sm dark:text-red-200"
    >
      <p className="font-medium">AI 재검증 대체 실행</p>
      <p className="break-words leading-relaxed">{message}</p>
    </div>
  );
}
