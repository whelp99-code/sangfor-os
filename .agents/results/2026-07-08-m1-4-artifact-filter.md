# M1-4: 상류 아티팩트 필터 (TDD)

## 구현

- `packages/business/src/mail/classify-rules.ts`: `isArtifactEntityName(name)` + `ARTIFACT_ENTITY_NAME_EXAMPLES` 상수 추가. "Example"/"Mail"/"Mails" 정확 일치, `Re:`/`Fw:`/`Fwd:` 접두, `<N min/sec/hour>` 형태, 2자 미만, 숫자·기호만(유니코드 인식 — 한글은 걸리지 않음)을 아티팩트로 판정.
- `packages/business/src/mail/classify-rules.test.ts`: 신규 `describe("isArtifactEntityName")` 42 케이스(true 12 + false 6 대표 케이스 포함, 파라미터화로 42 assertion) — TDD로 먼저 작성 후 구현.
- `packages/business/src/mail/classify-ai.ts`: 재검증 프롬프트의 하드코딩 아티팩트 예시 목록을 `ARTIFACT_ENTITY_NAME_EXAMPLES`에서 생성하도록 교체 — 프롬프트와 코드가 단일 소스 공유.
- `packages/business/src/mail/candidates-generate.ts`: `generateMailDerivedCandidates`/`generateMailDerivedCandidatesHybrid` 두 후보 생성 루프 모두에 필터 적용 — customer/partner 타입이고 `isArtifactEntityName`이 true면 DB 생성 없이 `console.log`만 남기고 skip.

opencode-coder(deepseek-v4-flash) 위임, diff 직접 리뷰 완료(4파일, +113/-1) — 스펙대로 정확히 구현됨.

## 검증

- `pnpm --filter @sangfor/business exec vitest run src/mail/classify-rules.test.ts` — 42/42 통과 (직접 재실행 확인).
- `pnpm --filter @sangfor/business exec vitest run src/mail/classify-ai.test.ts` — 17/17 통과, 무회귀.
- `pnpm --filter @sangfor/business exec tsc --noEmit` — clean.
- 라이브 드라이런: `POST /api/mail-candidates {"limit":30}` — `created:0, skipped:0` (최근 30개 스레드가 이미 전부 기존 후보 보유, 이번 실행에서는 신규 생성 경로 미실행 — 필터 자체는 유닛테스트로 전량 검증됨).

## 부수 발견 — 기존 정크 잔존 (M1-4 범위 밖, 후속 권고)

DB 조회 결과 이미 존재하는 `proposed` 상태 customer 후보 중 아티팩트명이 **95건**(`Mail` 34, `Example` 42, `Mails` 10, `<1 min` 2 등) 확인 — 이 필터가 막으려던 문제가 실제로 큐를 오염시키고 있었음을 확인. 이번 필터는 **신규 생성만** 차단하며 기존 95건은 그대로 남아있음(M1-4 acceptance는 "신규 생성 후보에 아티팩트 0"만 요구, 소급 정리는 범위 밖). M1-6 KPI 큐 분포 측정 시 이 95건이 노이즈로 섞여 있다는 점 감안 필요 — `/api/mail-candidates/cleanup`(현재는 중복·Nexias 전용) 확장이나 별도 backlog 항목으로 소급 정리 권고.
