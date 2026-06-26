/**
 * UX Status Label Mapping — Sangfor UX v3.2
 *
 * 내부 상태명을 사용자에게 표시할 업무 언어로 변환합니다.
 * UX 원칙: 사용자는 기술 용어가 아니라 업무 언어를 본다.
 */

/** Internal → User-facing status label mapping */
export const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  auto_validating: "자동 검증 중",
  auto_failed: "자동 검증 실패",
  remediation_required: "수정 필요",
  ready_for_human_approval: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
  stale: "재검토 필요",
  ai_draft: "AI 초안",
  human_reviewed: "사람 검토 완료",
  // Color Agent review status
  blue_review_required: "기술 검토 필요",
  blue_review_passed: "기술 검토 통과",
  blue_review_failed: "기술 검토 실패",
  red_review_required: "리스크 검토 필요",
  red_review_passed: "리스크 검토 통과",
  red_review_failed: "리스크 검토 실패",
  orange_review_required: "비즈니스 가치 검토 필요",
  orange_review_passed: "비즈니스 가치 검토 통과",
  orange_review_failed: "비즈니스 가치 검토 실패",
  gray_review_required: "문서 검토 필요",
  gray_review_passed: "문서 검토 통과",
  gray_review_failed: "문서 검토 실패",
  gray_evidence_missing: "근거 문서 부족",
  teal_review_required: "UX 검토 필요",
  teal_review_passed: "UX 검토 통과",
  teal_review_failed: "UX 검토 실패",
  // Approval action
  change_requested: "변경 요청",
  override_requested: "우회 승인 요청",
  override_approved: "우회 승인됨",
  override_rejected: "우회 반려",
  // Pipeline stages
  lead: "리드",
  qualification: "자격 검토",
  discovery: "Discovery",
  solution_fit: "Solution Fit",
  sizing: "Sizing",
  bom: "BoM",
  quote: "견적",
  commercial_approval: "Commercial 승인",
  proposal: "제안",
  poc: "PoC",
  sow: "SOW",
  delivery: "구축",
  acceptance: "인수",
  // Mail pipeline
  proposed: "제안됨",
  classified: "분류 완료",
  escalated: "에스컬레이션",
  reclassified: "재분류됨",
  // Device status
  online: "온라인",
  offline: "오프라인",
  warning: "주의",
  // Common
  active: "활성",
  inactive: "비활성",
  error: "오류",
  success: "성공",
  not_required: "해당 없음",
};

/** Color Agent display names */
export const COLOR_AGENT_LABELS: Record<string, { label: string; description: string }> = {
  blue: { label: "기술 검토", description: "기술 방향 / 구현 / 아키텍처" },
  red: { label: "리스크 검토", description: "보안 / 리스크 / 회귀 / 승인 우회" },
  orange: { label: "비즈니스 가치 검토", description: "고객 가치 / 매출 / ROI" },
  gray: { label: "문서 검토", description: "문서 / 결정 기록 / 근거" },
  teal: { label: "UX 검토", description: "UI/UX / 대시보드 / 가시성" },
};

/** Color Agent color CSS classes */
export const COLOR_AGENT_COLORS: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  blue: { dot: "bg-blue-agent", bg: "bg-blue-agent-bg", text: "text-blue-agent", border: "border-blue-agent-border" },
  red: { dot: "bg-red-agent", bg: "bg-red-agent-bg", text: "text-red-agent", border: "border-red-agent-border" },
  orange: { dot: "bg-orange-agent", bg: "bg-orange-agent-bg", text: "text-orange-agent", border: "border-orange-agent-border" },
  gray: { dot: "bg-gray-agent", bg: "bg-gray-agent-bg", text: "text-gray-agent", border: "border-gray-agent-border" },
  teal: { dot: "bg-teal-agent", bg: "bg-teal-agent-bg", text: "text-teal-agent", border: "border-teal-agent-border" },
};

/** Map internal status to user-facing label */
export function displayStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Get Color Agent display info */
export function colorAgentInfo(color: string): { label: string; description: string } {
  return COLOR_AGENT_LABELS[color] ?? { label: color, description: "" };
}
