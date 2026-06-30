/**
 * Maps a stage-transition error code (from the opportunities PATCH route)
 * to a user-facing Korean message shown in the deals workspace move banner.
 *
 * The API returns `{ error }` where error is either a bare reason or the
 * `illegal_stage_transition:<reason>` / `registration_gate:<reason>` forms
 * thrown by opportunity-center.ts.
 */
export function stageTransitionMessage(raw: string): string {
  // Strip the thrown prefix to get the leaf reason.
  const reason = raw.includes(":") ? raw.split(":").pop()! : raw;

  switch (reason) {
    case "stage_skip_forward":
      return "단계를 건너뛸 수 없습니다. 한 단계씩 진행해 주세요.";
    case "illegal_stage_regression":
      return "이 단계로 되돌릴 수 없습니다.";
    case "stage_is_terminal":
      return "수주/실패로 종료된 딜은 단계를 변경할 수 없습니다.";
    case "registration_not_submitted":
      return "딜 등록이 제출되지 않아 다음 단계로 진행할 수 없습니다. 총판을 통해 딜 등록을 먼저 제출하세요.";
    case "registration_rejected":
      return "딜 등록이 거절되어 다음 단계로 진행할 수 없습니다. 등록 상태를 먼저 해결하세요.";
    case "update_failed":
    default:
      return "단계 이동에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
}
