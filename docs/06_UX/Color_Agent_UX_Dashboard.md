# Color Agent UX Dashboard

## User Home 추가 위젯

```text
My Color Reviews
├── 내가 담당한 Color
├── 대기 중인 Handoff
├── 오늘 마감
├── Critical
└── Changes Requested
```

## Project Board 추가 컬럼

```text
To Blue
To Red
To Orange
To Gray
To Teal
Resolved
Escalated
```

## Approval Page 추가 정보

승인 화면에는 다음 Color Review 상태를 표시한다.

| Color | 상태 | 설명 |
|---|---|---|
| Blue | passed / pending / failed / not_required | 기술 검토 |
| Red | passed / pending / failed / not_required | 리스크 검토 |
| Orange | passed / pending / failed / not_required | 비즈니스 가치 검토 |
| Gray | passed / pending / failed / not_required | 문서/근거 검토 |
| Teal | passed / pending / failed / not_required | UX/가시성 검토 |

## 사용자 표시 원칙

내부 상태명은 숨기고 업무 언어로 표시한다.

```text
blue_review_required → 기술 검토 필요
red_review_failed → 리스크 검토 실패
gray_evidence_missing → 근거 문서 부족
teal_visibility_review → 화면/가시성 검토 중
```

## 색상 의존 금지

접근성을 위해 색상만으로 상태를 표시하지 않는다.

```text
좋음: Red — Risk Review Failed
나쁨: 빨간 점 하나만 표시
```
