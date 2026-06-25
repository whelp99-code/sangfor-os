export type ApprovalState =
  | 'pending' | 'auto_validating' | 'auto_failed'
  | 'remediation_required' | 'ready_for_human_approval'
  | 'approved' | 'rejected' | 'stale'

export const STATUS_LABELS: Record<ApprovalState, string> = {
  pending: '대기',
  auto_validating: '자동 검증 중',
  auto_failed: '자동 검증 실패',
  remediation_required: '수정 필요',
  ready_for_human_approval: '승인 대기',
  approved: '승인 완료',
  rejected: '반려',
  stale: '재검토 필요',
}

export const STATUS_VARIANTS: Record<ApprovalState, 'default' | 'secondary' | 'destructive' | 'outline' | 'warning'> = {
  pending: 'outline',
  auto_validating: 'secondary',
  auto_failed: 'destructive',
  remediation_required: 'warning',
  ready_for_human_approval: 'secondary',
  approved: 'default',
  rejected: 'destructive',
  stale: 'outline',
}

export const COLOR_AGENT_LABELS = {
  blue: { name: 'Blue', label: '기술 검토', statusLabels: { passed: '통과', pending: '검토 중', failed: '실패', not_required: '해당 없음' } },
  red: { name: 'Red', label: '리스크 검토', statusLabels: { passed: '통과', pending: '검토 중', failed: '실패', not_required: '해당 없음' } },
  orange: { name: 'Orange', label: '비즈니스 검토', statusLabels: { passed: '통과', pending: '검토 중', failed: '실패', not_required: '해당 없음' } },
  gray: { name: 'Gray', label: '문서/근거 검토', statusLabels: { passed: '통과', pending: '검토 중', failed: '실패', not_required: '해당 없음' } },
  teal: { name: 'Teal', label: 'UX/가시성 검토', statusLabels: { passed: '통과', pending: '검토 중', failed: '실패', not_required: '해당 없음' } },
}
