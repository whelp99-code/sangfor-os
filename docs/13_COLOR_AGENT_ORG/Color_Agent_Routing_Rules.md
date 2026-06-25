# Color Agent Routing Rules

## 목적

모든 업무에 모든 Color Agent를 붙이면 속도가 느려진다.  
따라서 V3.2는 위험도, 산출물 유형, 고객 노출 여부를 기준으로 필요한 Color Agent만 호출한다.

## 기본 Routing Matrix

| 조건 | Required Colors |
|---|---|
| 기술 구성/아키텍처 변경 | Blue |
| 구현/통합/DB/API 변경 | Blue + Red |
| 고객-facing 문서 | Orange + Gray + Teal |
| 견적/할인/마진 | Orange + Red + Gray |
| Restricted data 포함 | Red + Gray |
| AI 생성 산출물 | Gray + 해당 업무 Color |
| 보안/운영 영향 | Red + Blue |
| 대시보드/UI 변경 | Teal |
| 경영 의사결정 | Orange + Red + Gray |
| Vendor escalation | Red + Gray |
| Renewal/Upsell | Orange + Gray |
| PoC 착수 | Blue + Red + Orange |
| Delivery 착수 | Blue + Red + Gray |

## 위험도별 Routing

### Low

```text
Required: 업무 담당 Color 1개
Example: 내부 메모 요약, lead summary
```

### Medium

```text
Required: 업무 담당 Color + Gray
Example: Discovery Note, 내부 proposal draft
```

### High

```text
Required: Blue + Red + Orange + Gray
Example: Quote, PoC Plan, Delivery Plan, RCA
```

### Critical

```text
Required: Blue + Red + Orange + Gray + 사람 승인자
Optional: Teal if user-facing
Example: Production deployment, major discount, customer data export
```

## 중복 검토 방지

1. 같은 Color Agent가 이미 승인한 artifact version은 다시 검토하지 않는다.
2. artifact가 변경되면 diff 기준으로 재검토한다.
3. 단순 formatting 변경은 Gray만 검토한다.
4. UI label 변경은 Teal만 검토한다.
5. 보안 영향이 없는 기능 copy 변경은 Red를 호출하지 않는다.

## 자동 Routing 함수 입력

```json
{
  "artifact_type": "quote",
  "risk_level": "high",
  "customer_facing": true,
  "contains_restricted_data": false,
  "commercially_sensitive": true,
  "ui_impact": false,
  "technical_impact": false
}
```

## 자동 Routing 함수 출력

```json
{
  "required_colors": ["orange", "red", "gray"],
  "optional_colors": ["teal"],
  "requires_human_approval": true
}
```
