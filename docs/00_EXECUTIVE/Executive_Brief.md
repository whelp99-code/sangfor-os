# Executive Brief

## 목표

SANGFOR Platinum Partner IT 회사가 영업, 프리세일즈, 견적, PoC, 구축, 지원, 갱신 업무를 표준화하고 추적 가능하게 운영하도록 하는 **Agentic Company OS**를 구축한다.

이 시스템은 개발회사 전용이 아니다. 핵심 Core는 업종 독립적이며, 첫 번째 Industry Pack으로 SANGFOR 파트너 운영 모델을 구현한다.

## 왜 필요한가

SANGFOR 파트너 회사의 업무는 다음 병목에 취약하다.

1. 고객 요구사항이 이메일, 메신저, 문서에 흩어진다.
2. 프리세일즈 분석과 견적 산출이 사람마다 다르다.
3. 할인, 마진, PoC, 구축 승인 이력이 남지 않는다.
4. 납품 후 라이선스/자산/갱신 정보가 누락된다.
5. 장애/RCA 이력이 다음 갱신·업셀로 연결되지 않는다.
6. AI를 쓰더라도 산출물 검증과 승인 체계가 없으면 위험하다.

## 핵심 해결책

```text
Request → Qualification → Discovery → Solution Mapping
→ Quote → Approval → PoC → Delivery → Asset Activation
→ Support → Renewal → Upsell
```

모든 단계는 다음을 가진다.

- 담당자
- 산출물
- 자동 검증
- 사람 승인
- 감사 로그
- 고객/딜/자산 메모리

## 경영진이 보게 될 화면

```text
Executive Dashboard
├── 제품군별 매출 Pipeline
├── 예상 매출 / 예상 마진
├── 낮은 마진 딜
├── 승인 병목
├── PoC 성공률
├── 구축 지연
├── SLA 위반
├── 갱신 예정 금액
├── 업셀 후보
└── 권한/보안 경고
```

## 우선순위

1. Opportunity Pipeline
2. Quote / Margin Approval
3. Customer Asset / License Expiry
4. Renewal Reminder
5. Proposal Draft AI
6. Support / RCA

## 성공 기준

- 제안서 작성 시간 감소
- 견적 오류 감소
- 낮은 마진 딜 차단
- 갱신 누락 감소
- PoC 성공률 증가
- 지원/RCA 재작업 감소
- 승인 이력 100% 추적
- Restricted 고객정보 외부 유출 방지

## 경영진 의사결정 포인트

| 항목 | 결정 |
|---|---|
| MVP 범위 | Foundation + Deal + Quote + Asset/Renewal Seed |
| 첫 적용 조직 | SANGFOR 파트너 영업/프리세일즈/기술지원 |
| AI 범위 | 초안 생성까지만, 고객 발송 전 사람 승인 |
| 배포 방식 | 내부 운영 시스템 우선, SaaS 멀티테넌트 확장 준비 |
| 데이터 정책 | Restricted 고객 보안 정보는 엄격 분리 |
