# Phase 8 Implementation Plan — 툴링/워크스페이스/CI 표준화 (P20·21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마스터 플랜 Phase 8의 남은 실질 작업 — services 툴체인 정렬, tsconfig 모순 2건 해소, CI 중복 빌드 축소, cd.yml 정직화, services CI 신설, env/문서 정리 — 를 행위 무변화로 완료한다.

**Architecture:** 2026-07-03 사실 수집 결과, 마스터 플랜(7/2 작성)의 가정 다수가 이미 해소됨: TS ^5.9.3·vitest ^3.2.4는 메인 워크스페이스에 통일 완료, tsconfig base 상속 15/15, .env.example은 root/web/api/business 존재, CI e2e job 존재, cd.yml은 이미 workflow_dispatch 전용. 남은 것: (1) services 2곳의 버전 스큐 (2) tsconfig 모순 2건 (3) CI에서 packages 빌드 3회 중복 (4) cd.yml의 가짜 배포 echo 단계 (5) services가 CI 사각지대 (6) packages/db/.env.example 부재.

**중요 — §11-I(services 워크스페이스 편입) 결정 변경:** 마스터 플랜은 "편입 권장"이나, 실측 결과 **`@sangfor/shared` 패키지명이 루트(`packages/shared`)와 `services/sangfor-engineer-mcp/packages/shared`에서 충돌**하고, moduleResolution(NodeNext vs bundler)·vitest 메이저(4 vs 3)·node engines(>=22 vs 20)가 갈려 나이브한 편입이 불가능. 이번 사이클은 **대안 트랙(services 전용 CI job) + 편입 차단 사유 문서화**로 진행한다 (Task 8-5, 8-6).

**Tech Stack:** pnpm 10.28.1, TypeScript 5.9, vitest 3.x, GitHub Actions, Node 20 (workflow-service만 engines >=22 유지)

## Global Constraints

- **커밋 prefix**: 전부 `chore:` (P20·21 태그), 행위 무변화. 문서만 바꾸는 커밋은 `docs:` 허용.
- **검증 게이트**: 각 task 후 명시된 검증 명령 실행. 메인 워크스페이스를 건드리는 task는 `pnpm typecheck` 필수.
- **워크플로 YAML 검증**: actionlint 미설치 환경이므로 최소 `node -e "require('js-yaml')..."` 또는 `python3 -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" <file>`로 파싱 검증. (js-yaml이 없으면 python3 사용 — macOS 기본 제공.)
- **services 수정 시**: 각 서비스는 독립 pnpm 프로젝트 — 반드시 해당 서비스 디렉토리에서 `pnpm install` 후 그 서비스의 lockfile만 갱신. 루트 pnpm-lock.yaml 무변화.
- **engines 불변**: `services/sangfor-mcp-workflow`의 `engines.node >=22`는 건드리지 않는다 (런타임 요구 미확인 상태의 하향은 위험).
- **@sangfor/shared 이름 충돌**: 이번 사이클에서 rename 금지 — 문서화만.
- **Phase 0 보호**: mail-candidates golden snapshot 무변화 (메인 워크스페이스 test로 확인).

---

## 파일 구조

```
services/sangfor-mcp-workflow/
├── package.json                    (수정: TS/vitest/packageManager 정렬)
├── apps/{mcp-server,operator-console}/package.json      (수정: TS 정렬)
├── packages/{health-checker,shared,wiki-sync,workflow-core,workflow-engine}/package.json  (수정: TS 정렬)
├── pnpm-lock.yaml                  (재생성)
packages/mail-intelligence/tsconfig.json   (수정: inert outDir 제거)
packages/ui/tsconfig.json                  (수정: declaration 추가)
.github/workflows/
├── ci.yml                          (수정: lint+typecheck → static-checks 통합)
├── cd.yml                          (수정: 가짜 배포 단계 제거, 이름 정직화)
└── services-ci.yml                 (신규: services 2곳 typecheck/test)
packages/db/.env.example            (신규)
docs/DEV_REFERENCE.md               (수정: env 예시 목록 + services 결정 기록)
.agents/results/refactor/phase-8-report.md  (신규: 전/후 메트릭)
```

---

## Task 분할 (순차; 8-1과 8-2는 순서 무관)

```
Task 8-1: services 툴체인 버전 정렬 (workflow-service TS 5.7→5.9 등)
Task 8-2: tsconfig 모순 2건 해소 (mail-intelligence, ui)
Task 8-3: ci.yml — lint/typecheck 통합으로 중복 빌드 1회 제거
Task 8-4: cd.yml — 가짜 배포 단계 제거, production-build-check로 정직화
Task 8-5: services-ci.yml 신설 (편입 대안 트랙)
Task 8-6: packages/db/.env.example + DEV_REFERENCE + phase-8 리포트
```

---

## Task 8-1: services 툴체인 버전 정렬

**Files:**
- Modify: `services/sangfor-mcp-workflow/package.json`
- Modify: `services/sangfor-mcp-workflow/apps/mcp-server/package.json`
- Modify: `services/sangfor-mcp-workflow/apps/operator-console/package.json`
- Modify: `services/sangfor-mcp-workflow/packages/health-checker/package.json`
- Modify: `services/sangfor-mcp-workflow/packages/shared/package.json`
- Modify: `services/sangfor-mcp-workflow/packages/wiki-sync/package.json`
- Modify: `services/sangfor-mcp-workflow/packages/workflow-core/package.json`
- Modify: `services/sangfor-mcp-workflow/packages/workflow-engine/package.json`
- Regenerate: `services/sangfor-mcp-workflow/pnpm-lock.yaml`

**Interfaces:**
- Produces: workflow-service 전체가 typescript `^5.9.3`, vitest `^3.2.4`, packageManager `pnpm@10.28.1`로 정렬됨 (Task 8-5의 services-ci가 이 상태를 검증)

**Steps:**

- [ ] **Step 1: 현재 버전 확인**

```bash
grep -rn '"typescript"\|"vitest"\|"packageManager"' services/sangfor-mcp-workflow --include="package.json" | grep -v node_modules
```

Expected: typescript `^5.7.0` ×7곳(루트+apps 2+packages 5 중 선언된 곳), vitest `^3.0.0` (루트), packageManager `pnpm@10.12.4` (루트)

- [ ] **Step 2: 버전 문자열 일괄 교체**

각 package.json에서 (선언된 곳만):
- `"typescript": "^5.7.0"` → `"typescript": "^5.9.3"`
- `"vitest": "^3.0.0"` → `"vitest": "^3.2.4"`
- `"packageManager": "pnpm@10.12.4"` → `"packageManager": "pnpm@10.28.1"`

`engines.node: ">=22"`는 **변경 금지** (Global Constraints).

- [ ] **Step 3: 서비스 로컬 install로 lockfile 재생성**

```bash
cd services/sangfor-mcp-workflow && pnpm install
```

Expected: pnpm-lock.yaml 갱신, 에러 없음. `file:../sangfor-engineer-mcp/packages/sangfor-chrome` 의존이 그대로 해석되는지 확인.

- [ ] **Step 4: 서비스 자체 검증 (있는 스크립트만)**

```bash
cd services/sangfor-mcp-workflow && pnpm run --if-present typecheck && pnpm run --if-present build && pnpm run --if-present test -- --run
```

Expected: TS 5.9로 컴파일/테스트 통과. 실패 시 5.9 비호환 코드가 원인인지 확인하고, 코드 수정이 필요하면 BLOCKED로 보고 (행위 무변화 원칙).

- [ ] **Step 5: 루트 워크스페이스 무영향 확인**

```bash
git status --short | grep -v "^?? " | grep -v "services/sangfor-mcp-workflow" ; echo "clean if empty"
```

Expected: services/sangfor-mcp-workflow 외 변경 없음 (루트 pnpm-lock.yaml 무변화).

- [ ] **Step 6: Commit**

```bash
git add services/sangfor-mcp-workflow && \
git commit -m "chore: align workflow-service toolchain to workspace versions (P20)"
```

---

## Task 8-2: tsconfig 모순 2건 해소

**Files:**
- Modify: `packages/mail-intelligence/tsconfig.json`
- Modify: `packages/ui/tsconfig.json`

**Interfaces:**
- Consumes: `tsconfig.base.json`의 `noEmit: true` 기본값 (emit 패키지는 각자 override하는 현행 패턴 유지)
- Produces: 모순 0건 — mail-intelligence는 순수 typecheck 패키지로 명확화, ui는 d.ts 방출

**Steps:**

- [ ] **Step 1: 현재 상태 확인**

```bash
cat packages/mail-intelligence/tsconfig.json packages/ui/tsconfig.json
grep '"build"' packages/mail-intelligence/package.json packages/ui/package.json
```

Expected: mail-intelligence는 `outDir: "dist"` 선언 + build 스크립트 `tsc --noEmit`(방출 없음 — outDir이 죽은 설정). ui는 `noEmit: false` + outDir dist인데 `declaration` 부재.

- [ ] **Step 2: mail-intelligence — inert outDir 제거**

`packages/mail-intelligence/tsconfig.json`의 compilerOptions에서 `"outDir": "dist"` 라인 삭제 (noEmit 상속으로 어차피 방출 안 됨 — 죽은 설정 제거).

- [ ] **Step 3: ui — declaration 추가**

`packages/ui/tsconfig.json`의 compilerOptions에 `"declaration": true` 추가 (dist로 JS만 나가고 d.ts가 없던 것을 sibling emit 패키지들과 동일하게). `strict: false`는 이번에 건드리지 않음 (strict 전환은 행위 변경 가능성 — 이월 항목으로 리포트에 기록).

- [ ] **Step 4: 검증**

```bash
pnpm --filter @sangfor/ui build && ls packages/ui/dist/*.d.ts | head -3
pnpm typecheck
```

Expected: ui dist에 .d.ts 생성됨, 전역 typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/mail-intelligence/tsconfig.json packages/ui/tsconfig.json && \
git commit -m "chore: resolve tsconfig emit contradictions in mail-intelligence and ui (P21)"
```

---

## Task 8-3: ci.yml — lint/typecheck 통합 (중복 빌드 1회 제거)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 현행 job 구조 — lint(23-39행), typecheck(41-65행)가 각자 install→db:generate→packages build 수행
- Produces: 단일 `static-checks` job. `build` job의 `needs`가 `[static-checks, test]`로 변경됨. packages 빌드 3회→2회, install 5회→4회.

**Steps:**

- [ ] **Step 1: lint job과 typecheck job을 static-checks로 통합**

`.github/workflows/ci.yml`에서 `lint:`(23행)와 `typecheck:`(41행) 두 job을 삭제하고 아래 하나로 교체:

```yaml
  static-checks:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: aios
          POSTGRES_PASSWORD: aios_password
          POSTGRES_DB: aios_v2
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      # apps/web lint runs `eslint . && tsc --noEmit`, which needs the generated
      # Prisma client and the workspace *library* packages' built dist/types —
      # not a full `pnpm build` (that would also run `next build` and apps/api's
      # tsc build, which lint doesn't need).
      - run: pnpm db:generate
      - run: pnpm --filter "./packages/**" build
      - run: pnpm lint
      - run: pnpm typecheck
```

(postgres service는 기존 typecheck job에서 승계 — 제거는 별도 검증 없이는 위험하므로 유지. 기존 주석도 승계.)

- [ ] **Step 2: build job의 needs 갱신**

`needs: [lint, typecheck, test]` → `needs: [static-checks, test]`

- [ ] **Step 3: YAML 파싱 검증**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('valid')"
```

Expected: `valid`

- [ ] **Step 4: 브랜치 보호/필수 체크 확인**

```bash
gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.contexts' 2>/dev/null || echo "no protection or no required checks"
```

`lint`/`typecheck`가 required check로 등록되어 있으면 리포트에 "머지 후 required check 이름을 static-checks로 갱신 필요"라고 명시 (설정 변경은 사용자 몫).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml && \
git commit -m "chore: merge lint and typecheck CI jobs to cut duplicate package builds (P21)"
```

---

## Task 8-4: cd.yml 정직화 — 가짜 배포 단계 제거

**Files:**
- Modify: `.github/workflows/cd.yml`

**Interfaces:**
- Produces: cd.yml이 "프로덕션 빌드 검증" 워크플로로 정직하게 재정의됨 (배포하는 척하는 echo 제거)

**Steps:**

- [ ] **Step 1: 가짜 단계 제거 및 이름 변경**

`.github/workflows/cd.yml`을 아래 전체 내용으로 교체:

```yaml
name: Production Build Check

# NOTE: This repo has no real deployment target yet. This workflow only
# verifies that a production build succeeds on main. When a real deploy
# target exists, add the deploy/notify steps back with real actions.
on:
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: true

jobs:
  build-check:
    name: Production build check
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build
        env:
          NODE_ENV: production
```

- [ ] **Step 2: YAML 파싱 검증**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cd.yml')); print('valid')"
```

Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cd.yml && \
git commit -m "chore: replace fake deploy steps with honest production build check (P21)"
```

---

## Task 8-5: services-ci.yml 신설 (§11-I 편입 대안 트랙)

**Files:**
- Create: `.github/workflows/services-ci.yml`

**Interfaces:**
- Consumes: Task 8-1의 정렬된 workflow-service 툴체인; 각 서비스의 `--if-present` 스크립트
- Produces: services 2곳이 처음으로 CI 검증 커버리지를 가짐 (path-filtered)

**Steps:**

- [ ] **Step 1: 각 서비스의 사용 가능한 스크립트 확인**

```bash
python3 -c "import json;d=json.load(open('services/sangfor-engineer-mcp/package.json'));print(sorted(d.get('scripts',{}).keys()))"
python3 -c "import json;d=json.load(open('services/sangfor-mcp-workflow/package.json'));print(sorted(d.get('scripts',{}).keys()))"
```

기록: 어떤 typecheck/build/test 스크립트가 존재하는지. (`--if-present`를 쓰므로 워크플로는 그대로 동작하지만, 실제로 뭐가 도는지 리포트에 명시.)

- [ ] **Step 2: services-ci.yml 생성**

```yaml
name: Services CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'services/**'
      - '.github/workflows/services-ci.yml'
  push:
    branches: [main]
    paths:
      - 'services/**'
      - '.github/workflows/services-ci.yml'

jobs:
  engineer-mcp:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/sangfor-engineer-mcp
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          package_json_file: services/sangfor-engineer-mcp/package.json
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run --if-present typecheck
      - run: pnpm run --if-present build
      - run: pnpm run --if-present test -- --run

  mcp-workflow:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: services/sangfor-mcp-workflow
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          package_json_file: services/sangfor-mcp-workflow/package.json
      - uses: actions/setup-node@v4
        with:
          # workflow-service declares engines.node >=22
          node-version: '22'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run --if-present typecheck
      - run: pnpm run --if-present build
      - run: pnpm run --if-present test -- --run
```

주의: 서비스별 lockfile이 frozen 설치 가능해야 함 — Task 8-1에서 workflow-service lockfile을 재생성했으므로 OK. engineer-mcp는 lockfile 존재 여부를 확인하고(`ls services/sangfor-engineer-mcp/pnpm-lock.yaml`), 없으면 `pnpm install`(non-frozen)으로 두고 리포트에 명시.

- [ ] **Step 3: YAML 파싱 검증**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/services-ci.yml')); print('valid')"
```

Expected: `valid`

- [ ] **Step 4: 로컬 시뮬레이션 (각 서비스에서 CI와 동일 명령)**

```bash
cd services/sangfor-engineer-mcp && pnpm install && pnpm run --if-present typecheck && pnpm run --if-present test -- --run
cd services/sangfor-mcp-workflow && pnpm run --if-present typecheck && pnpm run --if-present test -- --run
```

Expected: 에러 없음. 실패하는 서비스 스크립트가 있으면 (기존 결함) 해당 스텝을 워크플로에서 `continue-on-error: true`로 두고 리포트에 사유 명시 — 처음부터 red CI를 만들지 않기 위함.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/services-ci.yml && \
git commit -m "chore: add services CI coverage (engineer-mcp, mcp-workflow) (P20)"
```

---

## Task 8-6: env 예시 보완 + 문서화 + phase-8 리포트

**Files:**
- Create: `packages/db/.env.example`
- Modify: `docs/DEV_REFERENCE.md` (§5 `### 환경 변수` 절)
- Create: `.agents/results/refactor/phase-8-report.md`

**Steps:**

- [ ] **Step 1: packages/db/.env.example 생성**

`packages/db/.env`의 **키 이름만** 확인 (값 절대 복사 금지):

```bash
grep -o '^[A-Z_]*' packages/db/.env
```

확인된 키들로 placeholder 파일 작성 (예상: DATABASE_URL 1개):

```bash
# packages/db/.env.example
# Prisma CLI (migrate/seed/studio) reads this file via dotenv when run from packages/db.
DATABASE_URL=postgresql://user:password@localhost:5434/sangfor_os
```

실제 키 목록이 다르면 그 키들을 placeholder 값으로 모두 포함.

- [ ] **Step 2: DEV_REFERENCE.md 환경 변수 절 갱신**

`docs/DEV_REFERENCE.md`의 `### 환경 변수` 절(235행 부근)에서 예시 파일 목록을 실제와 일치시킴:
- 기존 목록(web/api/business)에 `packages/db/.env.example`, `services/sangfor-engineer-mcp/.env.example`, `services/sangfor-mcp-workflow/.env.example` 추가
- 한 줄 추가: "코드가 참조하는 고유 env 변수는 web 29 / api 18 / business 36 (합집합 73)개로 example 파일들이 전부를 덮지는 않음 — 신규 변수 추가 시 해당 example 파일에 같이 추가할 것."

- [ ] **Step 3: phase-8-report.md 작성**

`.agents/results/refactor/phase-8-report.md`:

```markdown
# Phase 8 Report — 툴링/워크스페이스/CI 표준화 (2026-07-03)

## 전/후 메트릭
| 항목 | 전 | 후 |
|---|---|---|
| CI 1회당 packages/** 빌드 횟수 | 3 (lint/typecheck/test) | 2 (static-checks/test) |
| CI 1회당 pnpm install 횟수 | 5 | 4 |
| services CI 커버리지 | 0 서비스 | 2 서비스 (path-filtered) |
| tsconfig emit 모순 | 2건 (mail-intelligence inert outDir, ui declaration 부재) | 0건 |
| TS 버전 스큐 | workflow-service ^5.7.0 | 전 리포지토리 ^5.9.3 |
| vitest 스큐 | 3.0 / 3.2.4 / 4.1.8 | 3.2.4 (engineer-mcp만 4.x 유지 — 마스터 플랜 승인 예외) |
| packageManager 스큐 | 10.12.4 / 10.28.1 | 10.28.1 통일 |
| cd.yml | 가짜 배포 echo | 정직한 production build check |

## §11-I 결정 기록 (services 워크스페이스 편입)
마스터 플랜 권장은 "편입"이었으나 실측 차단 요인으로 이번 사이클은 대안 트랙(services 전용 CI) 채택:
1. `@sangfor/shared` 패키지명이 루트 `packages/shared`와 `services/sangfor-engineer-mcp/packages/shared`에서 충돌 — 편입 시 pnpm 워크스페이스 이름 충돌
2. moduleResolution 불일치: 루트 base=bundler, services=NodeNext
3. vitest 메이저 갈림(3 vs 4), workflow-service engines.node >=22 (루트는 20)
편입하려면: engineer-mcp의 shared rename → 두 서비스 워크스페이스 글롭 편입 → 툴체인 통일 → CI 재편. 별도 사이클로 이월.

## 이월 항목
- packages/ui `strict: false` (유일한 strict-off 패키지) — strict 전환은 코드 수정 수반, 별도 작업
- playwright 버전 스큐 (chrome ^1.60 / engineer-mcp ^1.56.1 / workflow ^1.61)
- 브랜치 보호 required check 이름 갱신 (lint·typecheck → static-checks) — 저장소 설정, 사용자 작업
- env 변수 73개 중 example 미기재분 정밀 감사
```

(표의 수치는 실제 실행 결과로 갱신할 것 — 특히 Task 8-5 Step 1에서 확인한 서비스 스크립트 목록과 Step 4 결과.)

- [ ] **Step 4: DEV_REFERENCE 변경 이력 1줄 추가**

`docs/DEV_REFERENCE.md`의 변경 이력 섹션(문서 말미)에 "2026-07-03: Phase 8 — CI static-checks 통합, services CI 신설, env example 정비" 형식으로 1줄 추가. (변경 이력 섹션이 없으면 생략하고 리포트에 명시.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/.env.example docs/DEV_REFERENCE.md .agents/results/refactor/phase-8-report.md && \
git commit -m "docs: add db env example, update env docs, record phase 8 report (P20)"
```

---

## Phase 8 최종 게이트

- [ ] **전역 검증 (메인 워크스페이스)**

```bash
pnpm lint && pnpm typecheck && pnpm test --run
```

Expected: 전부 green, golden snapshot 무변화.

- [ ] **워크플로 3개 YAML 파싱 재확인**

```bash
for f in .github/workflows/ci.yml .github/workflows/cd.yml .github/workflows/services-ci.yml; do python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1])); print(sys.argv[1], 'valid')" "$f"; done
```

- [ ] **커밋 확인**

```bash
git log --oneline | grep -E "P20|P21" | head -6
```

Expected: 6개 커밋.

- [ ] **PR 생성 후 실제 CI green 확인** (워크플로 변경의 진짜 검증은 CI 자체)
