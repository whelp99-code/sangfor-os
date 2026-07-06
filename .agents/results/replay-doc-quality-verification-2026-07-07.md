# 컬러게이트 능동 루프 — 라이브 검증 리포트

> **검증일**: 2026-07-07 (KST) · **대상**: `docs/plans/2026-07-04-color-gate-active-loop.md` Task 4
> **기준 커밋**: `6e4f421` (feat/replay-doc-quality = main) · **검증자**: main-loop (Opus)
> **판정**: 능동 루프(접지·재작업·정직한 에스컬레이션·무환각) **작동 확인**. 초기 실행은 게이트 통과 0/3(정직한 에스컬레이션만) → **게이트 캘리브레이션(정직성 규칙) 후 3/3 통과·승격 실증**. 양방향(pass→promote / fail→escalate) + anti-gaming 가드 모두 검증 완료.
>
> **1차 실행**(캘리브레이션 전) = §실행결과. **2차**(캘리브레이션 후) = §후속-캘리브레이션.

## 환경
- LLM: 로컬 9router `http://127.0.0.1:20128/v1` — `cx/gpt-5.4-mini`(생성) + `cx/gpt-5.4-mini-review`(검증) 서빙 확인, 라이브 응답.
- DB: docker postgres `localhost:5434/sangfor_os` (실데이터: 메일 1,237 · 고객 152 · KB청크 1,419). 볼륨 `sangfor-os_postgres_data` 보존.
- 백업: `.local-backups/sangfor_os-preapply-20260707-081426.sql` (전체 pg_dump 11M, 쓰기 전).
- 실행: `node <tsx> packages/business/scripts/replay-generate-documents.ts --apply`
  (⚠️ tsx 미설치 — store의 `tsx@4.22.4/dist/cli.mjs` 직접 호출. `@sangfor/shared` dist가 stale이라 `sanitizeJsonStrings` 누락 → `pnpm --filter @sangfor/shared build`로 해소 후 실행.)

## 실행 결과 (3개 딜)
| 딜 | 메일컨텍스트 | gate | attempts | 결과 | 실패 렌즈 |
|---|---|---|---|---|---|
| 인카금융서비스 | 51건(38 in) | ❌ false | 3 | ESCALATED(미승격) | gray, orange |
| 지에스이앤씨(GS E&C) | 89건(89 in) | ❌ false | 3 | ESCALATED(미승격) | blue, gray, orange |
| 씨젠 | 3건(3 in) | ❌ false | 3 | ESCALATED(미승격) | red, blue, gray, teal, orange (전부) |

**핵심 관찰**: 실패 렌즈 수가 접지 풍부도와 반비례(인카 2 < GS 3 < 씨젠 5). 메일 3건뿐인 씨젠은 전 렌즈 실패 → 게이트가 근거 충분성을 실질 반영(장식 아님).

## DoD 판정
1. **게이트 통과 or 정직한 에스컬레이션** — 🔶 부분. 에스컬레이션 절반은 완전 실증: 통과 0건이지만 **자동승격 0건**(`generated_documents` 7→7 무변화), 전건 escalated 표식. 멱등 확인(customers/opportunities/engagements 무변화). **단 "최소 일부 통과"는 미충족** → pass→`recordHumanDecision`→GeneratedDocument 해피패스는 이번 실행에서 미실증(과거 실행분 7건이 간접 증거).
2. **형태 일관** — 🔶 대체로. 전건 번호매김 섹션 제안서지만 섹션수 7/9/9로 편차(인카가 2섹션 적음). `0641ddc`(form consistency) 이후에도 잔여 드리프트.
3. **재작업으로 내용 심화** — ✅. v2(07-04 초기) 938자·확인필요 0 → v3(07-07) 2,712자·확인필요 10. 전건 attempts=3(초기+재작업2)까지 루프 작동.
4. **무환각(확인 필요로 남김)** — ✅ 강한 증거. 인카 본문에 "확인 필요" 10회(기준값 미상 지표를 지어내지 않고 `기준값 확인 필요 → 목표값 100%`로 명시). gray 렌즈가 이 미완결성을 정확히 지적 → **정직성이 게이트에 반영됨**(gaming 방지 성립).

## 접지 배선 증명 (`buildGroundedContext` 직접 호출)
- 인카 컨텍스트 4,422자 생성: `## 이 딜의 메일 타임라인 (20건, 시간순)` — 실제 스레드(2025-10-23 VM 라이선스 견적 문의 → 파트너 가격표 → 기술지원료 → 11-13 최종견적) 시간순 집약 + KB 섹션. 산출물의 딜특화 디테일("서버 2대·ISCSI 연동·PoC 대상")이 이 타임라인에서 유래.

## 남은 이슈 / 후속
- [ ] **승격 해피패스 미실증**: 게이트 통과 케이스가 이번에 없어 pass→promote 경로가 이 루프에서 재확인되지 않음. 접지가 두터운 딜을 고르거나 게이트 캘리브레이션을 검토해 최소 1건 통과를 실증할 것.
- [ ] **게이트 캘리브레이션 검토**: human-in-loop 특성상 AI 단독 통과가 드문 게 정상일 수 있으나, 통과율 0%는 캘리브레이션 재점검 필요(특히 gray가 "확인 필요"를 곧 감점으로 처리 → 정직성과 게이트 통과가 상충).
- [ ] **형태 드리프트**: presales 템플릿 섹션수 고정(7 vs 9) 재확인.
- [ ] tsx 미설치 / `@sangfor/shared` dist stale — 러너 실행 전제가 취약. `tsx`를 devDep로 추가하고 dist 빌드 훅 정리 권장.

## 후속-캘리브레이션 (게이트 정직성 규칙, 2026-07-07 2차)
**원인**: `gray(근거=완결성)`·일부 `orange`가 정직한 "확인 필요" 표기를 미완결로 감점 → 생성부는 "없는 값 지어내지 말고 확인 필요로" 강제 → **정직성과 게이트 통과가 구조적 충돌**(지어내지 않는 한 통과 불가).

**수정**(`color-gate-llm.ts` 프롬프트만, 임계값·코드 로직 불변 — 사용자 승인 Approach A):
- 판정 기준을 "출판 완성본" → **"사람 검토로 넘길 AI 초안 수준"**(human-in-loop)으로 재프레이밍.
- 정직성 규칙 추가: 컨텍스트에 **없는** 값을 명시적 "확인 필요"로 남긴 건 감점 아님. 감점은 ①환각 ②컨텍스트에 **있는데** 누락/회피 ③논리 모순 ④구조·서사 부재 에만. 단 "확인 필요"가 과도해 알맹이 없으면 fail(anti-gaming).
- `gray`/`orange` 렌즈 정의에 위 원칙 반영.

**검증**:
1. **격리 A/B** — 1차에서 gray+orange 실패했던 **동일 인카 본문(2,712자, 재생성 없음)** 을 새 게이트로 재판정 → **5렌즈 전원 PASS**. gray가 컨텍스트 실제 사실(01/05~06 일정·IDC 출입·ISCSI·서버 2대) 대조 확인 = 러버스탬프 아님.
2. **full 재실행(--apply)** — 인카(attempts=2: 실패→재작업→통과)·GS E&C(attempts=1)·씨젠(attempts=1) **3/3 gate=true → 승격**. `generated_documents` 7→10, `document_versions` 7→10, 3문서 전부 `status=approved`·engagement 연결·실본문(1,786~2,027자).
3. **씨젠 러버스탬프 검증** — 메일 3건뿐이나 게이트가 구체 사실 인용(11/25 10년 확약 협의·11/10 가격부담)으로 정당 통과. 확인필요 10회는 정직 표기.
4. **anti-gaming 가드 테스트** — 전부 "확인 필요"인 껍데기 제안서 → 5렌즈 전원 **FAIL**("컨텍스트에 있는 사실 미활용 + 대부분 확인필요라 근거부족"). 정직한 알맹이 통과 / 껍데기·회피 탈락 구분 성립.
5. **회귀** — `domain-ai` 유닛 12파일 98건 통과, 타입체크 클린. 게이트 테스트는 프롬프트 텍스트 미의존이라 무영향.

**잔여 관찰**: 게이트가 접지 **볼륨**(메일 건수)을 직접 가중하지 않음 — 소수라도 내용이 풍부한 메일이면 통과 가능(씨젠). human-in-loop 초안 게이트 취지엔 부합하나, 볼륨 가중이 필요하면 별도 knob(Approach A 범위 밖).

## 증거 파일
- `.agents/results/replay/generated-docs.json` (러너 리포트)
- `.local-backups/sangfor_os-preapply-20260707-081426.sql` (쓰기 전 스냅샷)
- `domain_decision_logs` 신규 3건(`ai_proposal`, case_ref=`eng:*`, color_gate_json에 lenses/attempts/escalated)
