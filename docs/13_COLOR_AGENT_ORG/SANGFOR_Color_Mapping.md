# SANGFOR Color Mapping

## 개요

SANGFOR Partner OS에서 Color Agent는 기존 업무 Persona를 대체하지 않는다.  
각 Color Agent는 업무 흐름의 특정 판단 관점을 담당한다.

## Workflow별 Color 참여

| Workflow 단계 | Required Colors | 이유 |
|---|---|---|
| Lead Intake | Orange | 고객 가치와 영업 가능성 판단 |
| Qualification | Orange + Gray | 진행 근거 기록 |
| Discovery | Blue + Gray | 기술 요구와 근거 수집 |
| Solution Mapping | Blue + Red + Orange | 기술 적합성, 리스크, 고객 가치 |
| BoM / Sizing | Blue + Gray | 기술 구성과 근거 |
| Quote / Discount | Orange + Red + Gray | 매출, 마진, 리스크, 승인 근거 |
| Proposal | Orange + Blue + Gray + Teal | 고객 가치, 기술, 문서, 가독성 |
| PoC Plan | Blue + Red + Orange | 기술 검증, 리스크, 수주 가능성 |
| Delivery Plan | Blue + Red + Gray | 구축 가능성, 운영 리스크, 근거 |
| Acceptance | Gray + Orange | 인수 증적, 고객 가치 확인 |
| Support / RCA | Red + Blue + Gray | 장애 리스크, 원인 분석, 근거 |
| Renewal | Orange + Gray | 매출 기회, 이력 근거 |
| Upsell | Orange + Blue | 고객 가치와 기술 적합성 |

## Persona 매핑

| Business Persona | 관련 Color |
|---|---|
| Sales Manager | Orange |
| Account Manager | Orange + Gray |
| Presales Engineer | Blue |
| Solution Architect | Blue + Red |
| Finance Manager | Red + Orange |
| Delivery Engineer | Blue + Gray |
| Support Engineer | Red + Blue |
| Vendor Liaison | Gray + Red |
| CEO | Orange + Red + Gray |
| Security Officer | Red |
| UX/Product Designer | Teal |
| Operator | Red + Blue |

## 예시: Commercial Gate

```text
Quote 생성
 → Orange: 고객 가치, 수주 가능성, 가격 전략 검토
 → Red: 할인율, 마진, 계약 리스크 검토
 → Gray: quote version, 근거, 승인 증적 정리
 → Finance/CEO: 공식 승인
```

## 예시: Proposal 고객 발송 전

```text
Proposal Draft 생성
 → Blue: 기술 정확성 검토
 → Orange: 고객 가치와 메시지 검토
 → Gray: 근거/버전/문서 완성도 검토
 → Teal: 읽기 쉬움과 표현 흐름 검토
 → Sales Manager: 고객 발송 승인
```
