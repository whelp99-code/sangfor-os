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
  // approve-connect-form
  connect_failed: "연결에 실패했습니다.",
  // policy-memory-manager
  failed_to_promote: "정책을 활성화하지 못했습니다.",
  // create-command-form
  create_failed: "생성에 실패했습니다.",
  // phase13 run panel
  phase13_run_failed: "Phase 13 실행에 실패했습니다.",
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
