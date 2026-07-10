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

**미검증**: `/sales` 커맨드바에서 `cx/gpt-5.4-mini`(main-fork persisted 기본값)로 실제 왕복 응답을 받는 것 자체. `cx/gpt-5.4-mini` 쿼터가 이 세션 전체(약 2일)에 걸쳐 지속적으로 429 — 단순 시간 경과로 회복되지 않아(§9-2 조사 참고: 다른 프로세스가 계속 소비 중이거나 더 긴 주기의 한도로 추정), 원 모델로의 실왕복 확인은 외부 요인으로 이번 세션 내 불가능. main-fork를 재빌드해 다른 모델로 임시 전환·검증·재전환하는 방법도 검토했으나, 빌드 1회에 수 분이 걸려(2회 필요) 비용 대비 가치가 낮다고 판단해 보류.

**결론**: env 정리·재기동이라는 M1-2의 실질 목표(구조적 위험 제거)는 달성됨. 순수 "cx 모델이 지금 응답하는가"는 인프라 문제가 아니라 외부 쿼터 문제 — cx 쿼터가 자연 회복되면 `/sales`에서 명령 1회로 재확인 권고(후속 backlog).
