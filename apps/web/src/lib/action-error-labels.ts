/**
 * Action error labels — maps internal error codes returned by API routes
 * to user-facing Korean messages. Error codes stay in English for logging
 * and parsing; only the rendered UI text is localized.
 */

const DEFAULT_ACTION_ERROR_MESSAGE = "요청을 처리하지 못했습니다.";

export const ACTION_ERROR_LABELS: Record<string, string> = {
  // orchestrator-panel
  recommend_failed: "스킬 추천에 실패했습니다.",
  run_failed: "실행에 실패했습니다.",
  preview_failed: "미리보기를 불러오지 못했습니다.",
  // mail-candidate-actions
  generate_failed: "메일 후보 생성에 실패했습니다.",
  patch_failed: "상태를 변경하지 못했습니다.",
  // approve-connect-form / portal-actions
  connect_failed: "연결에 실패했습니다.",
  sync_failed: "메일 동기화에 실패했습니다.",
  // policy-memory-manager
  failed_to_promote: "정책을 활성화하지 못했습니다.",
  // create-command-form
  create_failed: "생성에 실패했습니다.",
  // phase13 run panel
  phase13_run_failed: "Phase 13 실행에 실패했습니다.",
  // opportunity stage advance / registration gate
  registration_not_submitted: "딜 등록 승인이 필요한 단계입니다. 채널·등록 탭에서 딜 등록을 제출·승인받아 주세요.",
  registration_rejected: "딜 등록이 반려되어 다음 단계로 진행할 수 없습니다. 등록 상태를 확인해 주세요.",
  cannot_advance_stage: "더 진행할 다음 단계가 없습니다.",
  stage_skip_forward: "단계를 건너뛸 수 없습니다. 한 단계씩 진행해 주세요.",
  illegal_stage_regression: "이전 단계로 되돌릴 수 없습니다.",
  stage_is_terminal: "종료된 딜(수주·실패)은 단계를 변경할 수 없습니다.",
};

/**
 * Resolves an internal error code to its Korean message.
 * Unknown codes fall back to a generic message (overridable via `fallback`).
 */
export function actionErrorMessage(code?: string | null, fallback?: string): string {
  if (code && code in ACTION_ERROR_LABELS) {
    return ACTION_ERROR_LABELS[code];
  }
  return fallback ?? DEFAULT_ACTION_ERROR_MESSAGE;
}
