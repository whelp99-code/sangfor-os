# M1-2: main-fork·dev root .env OPENAI 이중 정의 정리

## 실행

- 두 `.env` 백업: `main-fork/.env.bak-0708`, `~/Playground/sangfor-os/.env.bak-0708`
- **main-fork**: 선행 zen 블록(`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` 3줄, 9행·13행·14행)을 주석 처리 — 80~82행의 9router 블록만 활성. `grep -c "^OPENAI_API_KEY"` → 1 확인.
- **dev root**: zen 값 3줄을 9router 값(`9router-local` / `http://127.0.0.1:20128/v1` / `cx/gpt-5.4-mini`)으로 직접 교체. `grep -c` → 1 확인.
- `bash scripts/prod-local.sh restart --build` 실행 — 세션이 밤사이 끊기며 첫 시도가 죽어 재실행, 최종적으로 `[web] http://localhost:3100 -> 200`, `[api] http://localhost:3210/health -> 200` 확인.

## 라이브 확인 — 부분 완료, 한계 명시

**직접 검증된 것**:
- 9router 인프라 자체는 정상(`/v1/models` 200, 여러 모델로 실제 채팅 완료 호출 성공 — §9-2에서 `kr/deepseek-3.2`로 수백 건 실호출 성공).
- env 이중정의 구조적 위험(Next dotenv가 선행 정의를 채택해 프로드가 한도소진된 zen을 볼 위험) 제거 확인(단일 활성 정의).
- main-fork 재기동 성공, 헬스체크 통과.

## 후속 (2026-07-10) — 모델을 Free-Tier로 전환 + 라이브 재확인

`cx/gpt-5.4-mini` 쿼터가 끝내 회복되지 않아, 사용자 지시로 두 `.env`의 `OPENAI_MODEL`을 9router의 `Free-Tier`(owned_by=combo, 내부적으로 `gpt-oss:120b` 라우팅)로 전환(`.env.bak-0710` 백업 후). main-fork `restart`(재빌드 불필요 — 서버사이드 env는 런타임에 `process.env`로 읽혀 빌드 산출물에 안 박힘) → 헬스체크 통과(web 307, api 200).

**라이브 커맨드바 왕복 시도**: `/api/auth/login` → 세션 토큰 획득 → `/api/agent/run` 호출 → `agent_run_failed: TypeError: fetch failed`. 서버 로그로 원인 특정: 9router/LLM 호출이 아니라 **`runMcpAgent`가 MCP 브릿지(:3600)를 fetch하는 단계**에서 실패 — 이번 세션에 MCP 서비스 스택(`make up`)을 띄운 적이 없어 발생한 별개의 사전 조건 미충족이지 모델 전환과 무관.

**최종 결론**: 9router 자체(`curl :20128/v1/chat/completions` 직접 호출, Free-Tier 모델) 정상 200 확인 — LLM 경로는 완전히 정상. 커맨드바 E2E는 MCP 브릿지 미기동이라는 별도 이슈로 막혀 있어, MCP 서비스(`make up`)를 띄운 후 재확인 필요(신규 backlog).
