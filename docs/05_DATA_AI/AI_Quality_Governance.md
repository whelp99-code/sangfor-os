# AI Quality Governance

## 목적

AI 산출물이 업무 초안으로는 유용하지만, 고객 발송/승인/견적/보안 권고의 근거가 되려면 품질 검증이 필요하다.

## AI Artifact Risk Level

| Artifact | Risk | Review |
|---|---|---|
| Lead Summary | Low | 작성자 확인 |
| Meeting Summary | Low | 작성자 확인 |
| Discovery Questions | Medium | Presales 확인 |
| Discovery Note Draft | Medium | Presales 검토 |
| Solution Fit Matrix | High | Solution Architect 승인 |
| Proposal Draft | High | Sales + Presales 승인 |
| Quote Draft | High | 서버 계산 + Finance 승인 |
| RCA Draft | High | Support Lead + Architect |
| Security Recommendation | Critical | Security Officer |

## AI Quality Gate

모든 AI Artifact는 다음 metadata를 가진다.

```json
{
  "ai_generated": true,
  "model": "model-name",
  "model_version": "version",
  "prompt_template_id": "uuid",
  "source_artifact_ids": ["uuid"],
  "confidence": "low|medium|high",
  "missing_fields": [],
  "known_gaps": [],
  "evidence_links": [],
  "human_review_required": true,
  "approved_for_customer": false
}
```

## 품질 검증 항목

1. Source Coverage: 입력 문서가 충분한가
2. Missing Information: 예산, 규모, 일정, 제품 기준 누락 여부
3. Contradiction: 문서 간 모순 여부
4. Product Fit: 제품군 추천 근거
5. Commercial Risk: 원가/할인/마진 누락
6. Security Risk: 민감정보 포함 여부
7. Customer-ready: 고객 발송 가능 여부

## Prompt Registry

```text
prompt_templates
- id
- key
- purpose
- risk_level
- template_text
- expected_schema
- allowed_tools
- version
- status
```

## Model Registry

```text
ai_models
- provider
- model_name
- version
- allowed_data_classification
- max_context
- cost_per_unit
- approved_by
```

## Evaluation Dataset

최소 dataset:

- lead summary 20건
- discovery question 20건
- proposal draft 20건
- RCA draft 10건
- prompt injection sample 20건
- quote mismatch sample 10건

## AI 품질 지표

```text
ai_artifact_rejection_rate
human_correction_rate
source_citation_coverage
missing_field_detection_rate
prompt_injection_detection_rate
customer_send_block_count
proposal_first_pass_approval_rate
rca_correction_rate
llm_cost_per_artifact
```

## UI 표시 기준

AI 산출물에는 항상 표시한다.

```text
AI Draft
Human Reviewed: No
Customer Send: Blocked
Sources: 3
Missing: budget, endpoint count
Confidence: Medium
```

## 금지

- AI Draft 직접 고객 발송
- AI가 견적 마진 직접 확정
- AI가 승인자 대신 승인
- AI가 벤더 포털에 자동 제출
- AI가 Restricted data를 외부로 전송


## V3.1 보강 — Golden Answer Set

AI 품질 검증은 단순 rejection rate가 아니라, 사람이 승인한 정답 예시와 비교해야 한다. 이를 위해 Golden Answer Set을 별도 관리한다.

### Golden Answer Set 구성

| Set | 최소 수량 | 목적 |
|---|---:|---|
| 정답 Lead Summary | 20 | 고객 문의 요약 품질 측정 |
| 정답 Discovery Questions | 30 | 누락 질문 탐지 품질 측정 |
| 정답 Solution Fit Matrix | 20 | SANGFOR 제품군 매핑 정확도 측정 |
| 정답 Proposal Draft | 20 | 고객 발송 전 제안서 구조/정확도 측정 |
| 정답 Quote Review | 20 | 마진/원가/서비스 누락 탐지 |
| 정답 RCA | 15 | 장애 원인 분석 품질 측정 |
| Prompt Injection Cases | 30 | 악성 입력 방어 측정 |

### Golden Answer Schema

```json
{
  "case_key": "solution_fit_ngfw_xdr_001",
  "artifact_type": "solution_fit_matrix",
  "input_payload": {
    "customer_profile": "...",
    "requirements": ["ransomware response", "vpn policy"],
    "known_constraints": ["budget unknown"]
  },
  "expected_output": {
    "recommended_products": ["NGFW", "XDR"],
    "missing_questions": ["endpoint count", "log retention", "budget range"],
    "must_not_claim": ["guaranteed ransomware prevention"],
    "reviewer_role": "solution_architect"
  },
  "evaluation_rubric": {
    "source_grounding": 30,
    "missing_info_detection": 25,
    "product_fit_accuracy": 25,
    "risk_flagging": 20
  }
}
```

### AI Release Gate

새 prompt, 새 model, 새 tool 조합은 운영 반영 전 다음 기준을 통과해야 한다.

```text
- Golden Answer Set score >= 85
- prompt injection block rate >= 95%
- restricted data leakage test = 0건
- source citation coverage >= 80%
- human correction rate가 이전 버전 대비 악화되지 않음
```

### DB 반영

V3.1 code skeleton에는 다음 테이블을 포함한다.

```text
ai_evaluation_datasets
ai_golden_answers
ai_quality_results
ai_prompt_runs
ai_prompt_templates
ai_models
```
