# Cost & ROI Model

## 비용 항목

| 비용 | 설명 |
|---|---|
| 초기 개발 | 백엔드, 프론트엔드, DB, 보안, DevOps |
| AI 비용 | LLM API, embedding, parsing |
| 인프라 | PostgreSQL, object storage, queue, monitoring |
| 보안 | encryption, audit, vulnerability testing |
| 운영 | admin, operator, support |
| 데이터 정리 | 고객, 제품, 자산, 라이선스 초기 입력 |
| 교육 | Sales, Presales, Finance, Delivery |
| 유지보수 | 버그, 정책, 제품군 업데이트 |

## ROI 발생 지점

```text
1. 제안서 작성 시간 감소
2. 견적 오류 감소
3. 낮은 마진 딜 방지
4. PoC 리소스 낭비 감소
5. 갱신 누락 감소
6. 지원/RCA 재작업 감소
7. 매출 pipeline 가시성 증가
8. 엔지니어 업무 표준화
```

## Before/After 지표

| 지표 | Baseline 필요 | 개선 목표 |
|---|---|---|
| 제안서 작성 시간 | 필요 | 감소 |
| quote turnaround | 필요 | 감소 |
| 견적 수정 횟수 | 필요 | 감소 |
| commercial 승인 소요 | 필요 | 감소 |
| 낮은 마진 딜 비율 | 필요 | 감소 |
| PoC 전환율 | 필요 | 증가 |
| 갱신 누락 | 필요 | 0에 가깝게 |
| SLA 위반 | 필요 | 감소 |
| RCA 작성 시간 | 필요 | 감소 |
| forecast accuracy | 필요 | 증가 |

## ROI Dashboard

```text
Revenue
├── pipeline amount
├── weighted forecast
├── renewal forecast
├── upsell opportunities

Efficiency
├── proposal time saved
├── quote turnaround
├── approval cycle time
├── support RCA cycle time

Risk Reduction
├── low margin deals blocked
├── stale approvals blocked
├── renewal missed avoided
├── unauthorized access blocked

AI Cost
├── LLM cost by tenant
├── cost per artifact
├── rejected AI draft cost
├── manual fallback usage
```

## 비용 통제

- tenant별 LLM budget
- user별 AI quota
- workflow당 최대 AI 호출
- large document analysis approval
- retry budget
- dead-letter queue
- unused AI feature review

## 투자 우선순위

1. Opportunity Pipeline
2. Quote/Margin Approval
3. Customer Asset/License Expiry
4. Renewal Reminder
5. Proposal Draft AI
6. Support/RCA

가장 먼저 AI Agent를 크게 만드는 것보다, 갱신 누락 방지와 낮은 마진 딜 차단이 더 직접적인 ROI를 만든다.
