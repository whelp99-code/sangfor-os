#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-.}"
mkdir -p "$ROOT"
CRITICAL_CONFLICTS=(
  "packages/automation/package.json"
  "packages/automation/src/index.ts"
  "packages/automation/tsconfig.json"
)

if [[ "${AIOS_SCAFFOLD_FORCE:-0}" != "1" ]]; then
  FOUND_CONFLICTS=()
  for path in "${CRITICAL_CONFLICTS[@]}"; do
    if [[ -e "$ROOT/$path" ]]; then
      FOUND_CONFLICTS+=("$path")
    fi
  done

  if (( ${#FOUND_CONFLICTS[@]} > 0 )); then
    {
      echo "Refusing to apply AIOS v1.0.2 scaffold because live implementation files already exist."
      echo "Run this script into an empty review directory first, or set AIOS_SCAFFOLD_FORCE=1 only after manual diff review."
      echo "Conflicts:"
      printf '  - %s\n' "${FOUND_CONFLICTS[@]}"
    } >&2
    exit 2
  fi
fi

mkdir -p "$ROOT/."
cat > "$ROOT/FILE_LIST.txt" <<'EOF_6344355181153187396'
IMPLEMENTATION_MAP.md
README_DELIVERY.md
apps/web/src/app/(portal)/commands/[id]/_examples/page.integration-example.tsx
apps/web/src/app/api/automation/analyze/route.ts
apps/web/src/app/api/automation/plan/route.ts
apps/web/src/app/api/automation/risk/route.ts
apps/web/src/components/automation/intent-lens-card.tsx
apps/web/src/components/automation/plan-preview-card.tsx
apps/web/src/components/automation/risk-summary-card.tsx
guides/CURSOR_SETUP_GUIDE.md
issues/PR-001.md
issues/PR-002.md
issues/PR-003.md
issues/PR-004.md
issues/PR-005.md
issues/PR-006.md
issues/PR-007.md
issues/PR-008.md
issues/PR-009.md
issues/PR-010.md
packages/automation/package.json
packages/automation/src/analysis/intent-analyzer.service.ts
packages/automation/src/api/automation.facade.ts
packages/automation/src/api/dto/analyze-command.input.ts
packages/automation/src/api/dto/assess-risk.input.ts
packages/automation/src/api/dto/draft-pr.input.ts
packages/automation/src/api/dto/generate-plan.input.ts
packages/automation/src/approvals/approval-summary.service.ts
packages/automation/src/bootstrap/config.ts
packages/automation/src/bootstrap/container.ts
packages/automation/src/bootstrap/env.ts
packages/automation/src/core/errors/automation-error.ts
packages/automation/src/core/errors/schema-validation-error.ts
packages/automation/src/core/types/automation.ts
packages/automation/src/core/types/command.ts
packages/automation/src/core/types/github.ts
packages/automation/src/core/types/model.ts
packages/automation/src/core/types/plan.ts
packages/automation/src/core/types/risk.ts
packages/automation/src/core/utils/id.ts
packages/automation/src/core/utils/time.ts
packages/automation/src/core/utils/trace.ts
packages/automation/src/github/pr-draft.service.ts
packages/automation/src/index.ts
packages/automation/src/planning/execution-plan.service.ts
packages/automation/src/prompts/intent/system.ts
packages/automation/src/prompts/planning/system.ts
packages/automation/src/providers/llm/base.ts
packages/automation/src/providers/llm/mock.provider.ts
packages/automation/src/providers/llm/openai-compatible.provider.ts
packages/automation/src/providers/telemetry/logger.ts
packages/automation/src/repositories/command-analysis.repository.ts
packages/automation/src/repositories/execution-plan.repository.ts
packages/automation/src/repositories/model-run.repository.ts
packages/automation/src/repositories/risk-assessment.repository.ts
packages/automation/src/risk/risk-engine.service.ts
packages/automation/src/router/fallback-policy.ts
packages/automation/src/router/model-router.ts
packages/automation/src/router/task-classifier.ts
packages/automation/src/schemas/command-analysis.schema.ts
packages/automation/src/schemas/execution-plan.schema.ts
packages/automation/src/schemas/model-run.schema.ts
packages/automation/src/schemas/pr-draft.schema.ts
packages/automation/src/schemas/risk-assessment.schema.ts
packages/automation/src/tests/unit/intent-analyzer.service.test.ts
packages/automation/tsconfig.json
packages/db/README_AI_SCHEMA.md
packages/db/prisma/schema.aios-v1.0.2.prisma
packages/db/sql/001_aios_v1_0_2.sql

EOF_6344355181153187396
mkdir -p "$ROOT/."
cat > "$ROOT/IMPLEMENTATION_MAP.md" <<'EOF_2674633886270576871'
# Implementation Map

## Delivered
- `packages/automation` scaffold
- DB draft schema
- Next.js API integration examples
- UI example components
- Cursor setup guide
- PR issue drafts

## What to merge first
1. `packages/automation`
2. `packages/db/prisma/schema.aios-v1.0.2.prisma`
3. `apps/web/src/app/api/automation/*`
4. `apps/web/src/components/automation/*`

## What remains after merge
- Replace in-memory repositories with real DB repositories
- Bind command detail page to actual command fetch logic
- Integrate auth/permissions
- Connect Langfuse, Redis, Octokit with live env

EOF_2674633886270576871
mkdir -p "$ROOT/."
cat > "$ROOT/README_DELIVERY.md" <<'EOF_7173925308231686997'
# AIOS v1.0.2 Full Implementation Pack

This pack provides a practical scaffold aligned to the uploaded project documentation:

- `packages/automation`: AI orchestration kernel scaffold
- `packages/db`: Prisma schema draft + SQL migration draft
- `apps/web`: minimal integration examples for API and UI
- `guides/CURSOR_SETUP_GUIDE.md`: step-by-step setup and integration guide
- `issues/PR-001.md` ~ `issues/PR-010.md`: GitHub issue drafts

## Important
Because the live GitHub repository contents were not directly fetchable in this environment, this pack is designed as a **merge-ready scaffold** aligned to the uploaded README and release notes, not a guaranteed exact patch against the latest remote HEAD.

Start with:
1. Read `guides/CURSOR_SETUP_GUIDE.md`
2. Copy `packages/automation/`
3. Merge `packages/db/prisma/schema.aios-v1.0.2.prisma`
4. Adapt `apps/web/` examples into your existing routes/components

EOF_7173925308231686997
mkdir -p "$ROOT/apps/web/src/app/(portal)/commands/[id]/_examples"
cat > "$ROOT/apps/web/src/app/(portal)/commands/[id]/_examples/page.integration-example.tsx" <<'EOF_7404820829623455098'
import { IntentLensCard } from "@/components/automation/intent-lens-card";
import { PlanPreviewCard } from "@/components/automation/plan-preview-card";
import { RiskSummaryCard } from "@/components/automation/risk-summary-card";

export default function CommandDetailAutomationExamplePage() {
  return (
    <div className="grid gap-4">
      <IntentLensCard
        analysis={{
          summary: "Add bulk approval support to approvals queue",
          intentType: "feature",
          domain: "approvals",
          confidence: 0.82,
          riskPreview: "medium",
          recommendedWorkflow: ["analyze", "plan", "risk", "approve"],
          missingInfo: []
        }}
      />

      <PlanPreviewCard
        plan={{
          goalSummary: "Implement bulk approval support with validation and rollback steps.",
          impactedApps: ["apps/web"],
          impactedPackages: ["packages/automation", "packages/db"],
          expectedFiles: [
            "apps/web/src/app/api/automation/analyze/route.ts",
            "packages/automation/src/api/automation.facade.ts"
          ],
          dbChangeRequired: false,
          migrationRequired: false,
          testPlan: ["pnpm lint", "pnpm test", "pnpm build"],
          rollbackPlan: ["revert route changes", "disable feature flag"]
        }}
      />

      <RiskSummaryCard
        risk={{
          riskLevel: "medium",
          reasons: ["Feature changes affect approval workflow."],
          requiresHumanApproval: true,
          requiredReviewerRole: "lead",
          recommendedChecks: ["pnpm lint", "pnpm test", "pnpm build"]
        }}
      />
    </div>
  );
}

EOF_7404820829623455098
mkdir -p "$ROOT/apps/web/src/app/api/automation/analyze"
cat > "$ROOT/apps/web/src/app/api/automation/analyze/route.ts" <<'EOF_3789060372924371915'
import { NextResponse } from "next/server";
import { createAutomationContainer } from "@ai-portal/automation";

export async function POST(request: Request) {
  const body = await request.json() as { commandId: string; rawText: string };
  const { facade } = createAutomationContainer();

  const analysis = await facade.analyzeCommand({
    commandId: body.commandId,
    rawText: body.rawText
  });

  return NextResponse.json({ analysis });
}

EOF_3789060372924371915
mkdir -p "$ROOT/apps/web/src/app/api/automation/plan"
cat > "$ROOT/apps/web/src/app/api/automation/plan/route.ts" <<'EOF_8974918516180102664'
import { NextResponse } from "next/server";
import { createAutomationContainer } from "@ai-portal/automation";

export async function POST(request: Request) {
  const body = await request.json() as { commandId: string; rawText: string };
  const { facade } = createAutomationContainer();

  const plan = await facade.generateExecutionPlan({
    commandId: body.commandId,
    rawText: body.rawText
  });

  return NextResponse.json({ plan });
}

EOF_8974918516180102664
mkdir -p "$ROOT/apps/web/src/app/api/automation/risk"
cat > "$ROOT/apps/web/src/app/api/automation/risk/route.ts" <<'EOF_1131181891562092603'
import { NextResponse } from "next/server";
import { createAutomationContainer } from "@ai-portal/automation";

export async function POST(request: Request) {
  const body = await request.json() as {
    commandId: string;
    expectedFiles?: string[];
    dbChangeRequired?: boolean;
    migrationRequired?: boolean;
  };
  const { facade } = createAutomationContainer();

  const risk = await facade.assessRisk({
    commandId: body.commandId,
    expectedFiles: body.expectedFiles ?? [],
    dbChangeRequired: body.dbChangeRequired ?? false,
    migrationRequired: body.migrationRequired ?? false
  });

  return NextResponse.json({ risk });
}

EOF_1131181891562092603
mkdir -p "$ROOT/apps/web/src/components/automation"
cat > "$ROOT/apps/web/src/components/automation/intent-lens-card.tsx" <<'EOF_7392862237412334789'
type IntentLensCardProps = {
  analysis: {
    summary: string;
    intentType: string;
    domain: string;
    confidence: number;
    riskPreview: string;
    recommendedWorkflow: string[];
    missingInfo: string[];
  };
};

export function IntentLensCard({ analysis }: IntentLensCardProps) {
  return (
    <div className="rounded-2xl border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Intent Lens</h3>
        <span className="rounded-full border px-2 py-1 text-xs">{analysis.riskPreview}</span>
      </div>

      <div className="space-y-2 text-sm">
        <p><strong>Summary:</strong> {analysis.summary}</p>
        <p><strong>Intent:</strong> {analysis.intentType}</p>
        <p><strong>Domain:</strong> {analysis.domain}</p>
        <p><strong>Confidence:</strong> {(analysis.confidence * 100).toFixed(0)}%</p>
      </div>

      <div className="mt-4">
        <h4 className="mb-2 font-medium">Workflow</h4>
        <ul className="list-disc pl-5 text-sm">
          {analysis.recommendedWorkflow.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      {analysis.missingInfo.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-2 font-medium">Missing Info</h4>
          <ul className="list-disc pl-5 text-sm">
            {analysis.missingInfo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

EOF_7392862237412334789
mkdir -p "$ROOT/apps/web/src/components/automation"
cat > "$ROOT/apps/web/src/components/automation/plan-preview-card.tsx" <<'EOF_8986950845406227939'
type PlanPreviewCardProps = {
  plan: {
    goalSummary: string;
    impactedApps: string[];
    impactedPackages: string[];
    expectedFiles: string[];
    dbChangeRequired: boolean;
    migrationRequired: boolean;
    testPlan: string[];
    rollbackPlan: string[];
  };
};

export function PlanPreviewCard({ plan }: PlanPreviewCardProps) {
  return (
    <div className="rounded-2xl border p-4 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold">Plan Preview</h3>
      <div className="space-y-2 text-sm">
        <p><strong>Goal:</strong> {plan.goalSummary}</p>
        <p><strong>Apps:</strong> {plan.impactedApps.join(", ")}</p>
        <p><strong>Packages:</strong> {plan.impactedPackages.join(", ")}</p>
        <p><strong>DB change:</strong> {plan.dbChangeRequired ? "Yes" : "No"}</p>
        <p><strong>Migration:</strong> {plan.migrationRequired ? "Yes" : "No"}</p>
      </div>

      <div className="mt-4">
        <h4 className="mb-2 font-medium">Expected Files</h4>
        <ul className="list-disc pl-5 text-sm">
          {plan.expectedFiles.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 font-medium">Test Plan</h4>
          <ul className="list-disc pl-5 text-sm">
            {plan.testPlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-2 font-medium">Rollback Plan</h4>
          <ul className="list-disc pl-5 text-sm">
            {plan.rollbackPlan.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

EOF_8986950845406227939
mkdir -p "$ROOT/apps/web/src/components/automation"
cat > "$ROOT/apps/web/src/components/automation/risk-summary-card.tsx" <<'EOF_6903155763565649461'
type RiskSummaryCardProps = {
  risk: {
    riskLevel: string;
    reasons: string[];
    requiresHumanApproval: boolean;
    requiredReviewerRole: string;
    recommendedChecks: string[];
  };
};

export function RiskSummaryCard({ risk }: RiskSummaryCardProps) {
  return (
    <div className="rounded-2xl border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Risk Summary</h3>
        <span className="rounded-full border px-2 py-1 text-xs">{risk.riskLevel}</span>
      </div>

      <div className="space-y-2 text-sm">
        <p><strong>Human Approval:</strong> {risk.requiresHumanApproval ? "Required" : "Not required"}</p>
        <p><strong>Reviewer:</strong> {risk.requiredReviewerRole}</p>
      </div>

      <div className="mt-4">
        <h4 className="mb-2 font-medium">Reasons</h4>
        <ul className="list-disc pl-5 text-sm">
          {risk.reasons.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <h4 className="mb-2 font-medium">Recommended Checks</h4>
        <ul className="list-disc pl-5 text-sm">
          {risk.recommendedChecks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

EOF_6903155763565649461
mkdir -p "$ROOT/guides"
cat > "$ROOT/guides/CURSOR_SETUP_GUIDE.md" <<'EOF_4019562913721264447'
# Cursor 적용 가이드

이 문서는 이 패치 팩을 실제 저장소에 붙이는 방법을 설명합니다.

## 1. 가장 쉬운 적용 방식

### 방식 A: 이 스크립트 실행
```bash
bash scripts/apply-aios-v1-0-2-full-impl.sh .
```

### 방식 B: Cursor Agent에게 단계별로 맡기기
Cursor Chat 또는 Agent에 아래 순서로 붙여넣습니다.

#### 1단계
```text
현재 워크스페이스는 ai-automation-work-portal 저장소다.
scripts/apply-aios-v1-0-2-full-impl.sh가 생성한 packages/automation 전체를 저장소에 반영해라.
기존 tsconfig.base.json, pnpm workspace, path alias와 충돌 나는 부분은 저장소 기준으로 맞춰라.
변경 후 type error가 나는 import는 현재 저장소 구조에 맞게 수정해라.
```

#### 2단계
```text
packages/db/prisma/schema.aios-v1.0.2.prisma 내용을 기존 Prisma schema에 병합해라.
기존 Command 관련 모델이 이미 있으면 중복 생성하지 말고 누락 필드만 병합해라.
병합 후 migration 초안을 생성해라.
```

#### 3단계
```text
apps/web/src/app/api/automation/analyze/route.ts
apps/web/src/app/api/automation/plan/route.ts
apps/web/src/app/api/automation/risk/route.ts
를 현재 Next.js app router 구조에 맞게 반영해라.
기존 인증/에러 핸들링 패턴이 있으면 그 패턴을 따르도록 수정해라.
```

#### 4단계
```text
apps/web/src/components/automation 아래 컴포넌트를 현재 UI 시스템에 맞게 반영해라.
shadcn/ui가 이미 있으면 Card, Badge, Separator 등을 사용하도록 리팩터링해라.
```

## 2. 권장 로컬 적용 순서

### Step 1. 저장소 준비
```bash
git checkout main
pnpm install
```

### Step 2. 패치 생성
```bash
bash scripts/apply-aios-v1-0-2-full-impl.sh .
```

### Step 3. DB 스키마 병합
Prisma를 쓰고 있으면 기존 schema에 `packages/db/prisma/schema.aios-v1.0.2.prisma`를 병합하고 migration을 생성합니다.

### Step 4. 실행
```bash
docker compose up -d
pnpm dev
pnpm lint
pnpm test
pnpm build
```

## 3. 주의점
- 이 스캐폴드는 저장소 원격 HEAD에 정밀 패치한 결과물이 아니라, 현재 문서 기준 merge-ready scaffold입니다.
- 기존 모델/테이블/타입이 있으면 중복 생성하지 말고 병합해야 합니다.
- `Command` 모델이 이미 있으면 새로 만들지 말고 관계만 추가하세요.

EOF_4019562913721264447
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-001.md" <<'EOF_8583476624858361696'
# PR-001 — feat(automation): bootstrap package structure and core contracts

## Goal
Create the initial `packages/automation` scaffold and core contracts.

## Scope
- package.json
- tsconfig
- bootstrap layer
- core types/errors/utils
- facade entrypoint

## Done when
- package is importable from the monorepo
- basic TypeScript build passes
- no runtime references to unavailable providers by default

EOF_8583476624858361696
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-002.md" <<'EOF_6714095644079987102'
# PR-002 — feat(automation): add environment config and feature flags

## Goal
Introduce environment validation and feature flags for automation.

## Scope
- env schema
- config builder
- feature flags for Langfuse/GitHub/provider selection

## Done when
- invalid env fails fast
- config is testable and isolated

EOF_6714095644079987102
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-003.md" <<'EOF_3711993062037835703'
# PR-003 — feat(db): add command analysis and model run tables

## Goal
Add storage for command analyses and model run metadata.

## Scope
- command_analyses table
- model_runs table
- repository layer skeleton

## Done when
- migration draft exists
- CRUD repository tests can be added on top

EOF_3711993062037835703
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-004.md" <<'EOF_8226673508306291511'
# PR-004 — feat(automation): add command analysis schemas and DTOs

## Goal
Define Zod schemas and DTOs for command analysis.

## Scope
- command-analysis schema
- DTO inputs/outputs
- schema versioning

## Done when
- invalid payloads are rejected
- services consume normalized DTOs

EOF_8226673508306291511
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-005.md" <<'EOF_3249825882800917548'
# PR-005 — feat(automation): implement llm provider abstraction

## Goal
Create a provider-agnostic LLM client layer.

## Scope
- base provider contract
- mock provider
- OpenAI-compatible provider
- normalized usage metadata

## Done when
- providers are swappable without changing services

EOF_3249825882800917548
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-006.md" <<'EOF_8123344806770247046'
# PR-006 — feat(automation): implement task classifier and model router

## Goal
Route different automation tasks to different model policies.

## Scope
- task classifier
- model router
- fallback policy

## Done when
- intent/planning/risk tasks resolve to expected routes

EOF_8123344806770247046
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-007.md" <<'EOF_8931753297525409402'
# PR-007 — feat(automation): implement intent analyzer service

## Goal
Analyze natural language commands into structured intent.

## Scope
- prompt
- analyzer service
- missing info detector
- repository persistence

## Done when
- command analysis is created and returned through the facade

EOF_8931753297525409402
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-008.md" <<'EOF_9178637851118647711'
# PR-008 — feat(web): expose command analysis API and command detail integration

## Goal
Expose command analysis through an app router API and connect it to command detail usage.

## Scope
- `/api/automation/analyze`
- request/response typing
- integration-ready example page

## Done when
- analysis can be called from the web app

EOF_9178637851118647711
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-009.md" <<'EOF_2666777627117757545'
# PR-009 — feat(web): add intent lens panel to command detail page

## Goal
Render Intent Lens as a reusable UI card.

## Scope
- summary
- intent/domain/confidence
- workflow list
- missing info section

## Done when
- component renders with mock or live analysis data

EOF_2666777627117757545
mkdir -p "$ROOT/issues"
cat > "$ROOT/issues/PR-010.md" <<'EOF_4251709185339131521'
# PR-010 — feat(db): add execution plans table and repositories

## Goal
Add execution plan persistence for planning output.

## Scope
- execution_plans table
- repository
- Prisma/SQL draft

## Done when
- execution plan data can be stored and retrieved

EOF_4251709185339131521
mkdir -p "$ROOT/packages/automation"
cat > "$ROOT/packages/automation/package.json" <<'EOF_7651393498291518013'
{
  "name": "@ai-portal/automation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}

EOF_7651393498291518013
mkdir -p "$ROOT/packages/automation"
cat > "$ROOT/packages/automation/tsconfig.json" <<'EOF_1818073568269429883'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}

EOF_1818073568269429883
mkdir -p "$ROOT/packages/automation/src"
cat > "$ROOT/packages/automation/src/index.ts" <<'EOF_7259614339464111851'
export { createAutomationContainer } from "./bootstrap/container";
export { AutomationFacade } from "./api/automation.facade";
export type { AnalyzeCommandInput } from "./api/dto/analyze-command.input";
export type { GeneratePlanInput } from "./api/dto/generate-plan.input";
export type { AssessRiskInput } from "./api/dto/assess-risk.input";

EOF_7259614339464111851
mkdir -p "$ROOT/packages/automation/src/bootstrap"
cat > "$ROOT/packages/automation/src/bootstrap/env.ts" <<'EOF_8199574548871735827'
import { z } from "zod";

export const automationEnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  AIOS_ENABLE_LANGFUSE: z.enum(["true", "false"]).optional(),
  AIOS_ENABLE_GITHUB: z.enum(["true", "false"]).optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional()
});

export type AutomationEnv = z.infer<typeof automationEnvSchema>;

export function readAutomationEnv(source: NodeJS.ProcessEnv = process.env): AutomationEnv {
  return automationEnvSchema.parse(source);
}

EOF_8199574548871735827
mkdir -p "$ROOT/packages/automation/src/bootstrap"
cat > "$ROOT/packages/automation/src/bootstrap/config.ts" <<'EOF_8679385528681257062'
import { readAutomationEnv } from "./env";

export function createAutomationConfig() {
  const env = readAutomationEnv();

  return {
    env,
    features: {
      langfuse: env.AIOS_ENABLE_LANGFUSE === "true",
      github: env.AIOS_ENABLE_GITHUB === "true"
    }
  };
}

EOF_8679385528681257062
mkdir -p "$ROOT/packages/automation/src/bootstrap"
cat > "$ROOT/packages/automation/src/bootstrap/container.ts" <<'EOF_7694605343628040744'
import { createAutomationConfig } from "./config";
import { MockLlmProvider } from "../providers/llm/mock.provider";
import { IntentAnalyzerService } from "../analysis/intent-analyzer.service";
import { ExecutionPlanService } from "../planning/execution-plan.service";
import { RiskEngineService } from "../risk/risk-engine.service";
import { CommandAnalysisRepository } from "../repositories/command-analysis.repository";
import { ExecutionPlanRepository } from "../repositories/execution-plan.repository";
import { RiskAssessmentRepository } from "../repositories/risk-assessment.repository";
import { ModelRunRepository } from "../repositories/model-run.repository";
import { AutomationFacade } from "../api/automation.facade";

export function createAutomationContainer() {
  const config = createAutomationConfig();
  const llm = new MockLlmProvider();

  const commandAnalysisRepository = new CommandAnalysisRepository();
  const executionPlanRepository = new ExecutionPlanRepository();
  const riskAssessmentRepository = new RiskAssessmentRepository();
  const modelRunRepository = new ModelRunRepository();

  const intentAnalyzer = new IntentAnalyzerService(llm, commandAnalysisRepository, modelRunRepository);
  const executionPlanner = new ExecutionPlanService(llm, executionPlanRepository, modelRunRepository);
  const riskEngine = new RiskEngineService(riskAssessmentRepository);

  const facade = new AutomationFacade(intentAnalyzer, executionPlanner, riskEngine);

  return {
    config,
    facade,
    repositories: {
      commandAnalysisRepository,
      executionPlanRepository,
      riskAssessmentRepository,
      modelRunRepository
    }
  };
}

EOF_7694605343628040744
mkdir -p "$ROOT/packages/automation/src/schemas"
cat > "$ROOT/packages/automation/src/schemas/command-analysis.schema.ts" <<'EOF_7749705625752495554'
import { z } from "zod";

export const commandAnalysisSchema = z.object({
  commandId: z.string(),
  summary: z.string(),
  intentType: z.string(),
  domain: z.string(),
  confidence: z.number().min(0).max(1),
  riskPreview: z.enum(["low", "medium", "high"]),
  recommendedWorkflow: z.array(z.string()),
  missingInfo: z.array(z.string()),
  model: z.string(),
  traceId: z.string()
});

export type CommandAnalysis = z.infer<typeof commandAnalysisSchema>;

EOF_7749705625752495554
mkdir -p "$ROOT/packages/automation/src/schemas"
cat > "$ROOT/packages/automation/src/schemas/execution-plan.schema.ts" <<'EOF_4743517378571457607'
import { z } from "zod";

export const executionPlanSchema = z.object({
  commandId: z.string(),
  goalSummary: z.string(),
  impactedApps: z.array(z.string()),
  impactedPackages: z.array(z.string()),
  expectedFiles: z.array(z.string()),
  dbChangeRequired: z.boolean(),
  migrationRequired: z.boolean(),
  testPlan: z.array(z.string()),
  rollbackPlan: z.array(z.string()),
  approvalHints: z.array(z.string()),
  model: z.string(),
  traceId: z.string()
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

EOF_4743517378571457607
mkdir -p "$ROOT/packages/automation/src/schemas"
cat > "$ROOT/packages/automation/src/schemas/risk-assessment.schema.ts" <<'EOF_5927839800198309628'
import { z } from "zod";

export const riskAssessmentSchema = z.object({
  commandId: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]),
  reasons: z.array(z.string()),
  requiresHumanApproval: z.boolean(),
  requiredReviewerRole: z.string(),
  recommendedChecks: z.array(z.string()),
  traceId: z.string()
});

export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

EOF_5927839800198309628
mkdir -p "$ROOT/packages/automation/src/schemas"
cat > "$ROOT/packages/automation/src/schemas/model-run.schema.ts" <<'EOF_352115589894794862'
import { z } from "zod";

export const modelRunSchema = z.object({
  commandId: z.string(),
  phase: z.string(),
  provider: z.string(),
  model: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  success: z.boolean(),
  schemaValid: z.boolean(),
  fallbackFrom: z.string().optional(),
  fallbackReason: z.string().optional(),
  traceId: z.string()
});

export type ModelRun = z.infer<typeof modelRunSchema>;

EOF_352115589894794862
mkdir -p "$ROOT/packages/automation/src/schemas"
cat > "$ROOT/packages/automation/src/schemas/pr-draft.schema.ts" <<'EOF_788331953430940359'
import { z } from "zod";

export const prDraftSchema = z.object({
  commandId: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string())
});

export type PrDraft = z.infer<typeof prDraftSchema>;

EOF_788331953430940359
mkdir -p "$ROOT/packages/automation/src/router"
cat > "$ROOT/packages/automation/src/router/task-classifier.ts" <<'EOF_2459340530485898149'
export function classifyTask(rawText: string) {
  const normalized = rawText.toLowerCase();
  if (normalized.includes("risk")) return "risk" as const;
  if (normalized.includes("plan")) return "planning" as const;
  return "intent" as const;
}

EOF_2459340530485898149
mkdir -p "$ROOT/packages/automation/src/router"
cat > "$ROOT/packages/automation/src/router/model-router.ts" <<'EOF_1231022907618861716'
export function routeModel(task: "intent" | "planning" | "risk") {
  switch (task) {
    case "planning":
      return { provider: "mock", model: "planner-v1" };
    case "risk":
      return { provider: "mock", model: "risk-v1" };
    default:
      return { provider: "mock", model: "intent-v1" };
  }
}

EOF_1231022907618861716
mkdir -p "$ROOT/packages/automation/src/router"
cat > "$ROOT/packages/automation/src/router/fallback-policy.ts" <<'EOF_7573314229944113191'
export function getFallbackPolicy() {
  return {
    retryCount: 1,
    fallbackProvider: "mock",
    fallbackModel: "fallback-v1"
  };
}

EOF_7573314229944113191
mkdir -p "$ROOT/packages/automation/src/repositories"
cat > "$ROOT/packages/automation/src/repositories/command-analysis.repository.ts" <<'EOF_7295911277020875884'
import type { CommandAnalysis } from "../schemas/command-analysis.schema";

export class CommandAnalysisRepository {
  private readonly store = new Map<string, CommandAnalysis>();

  async save(input: CommandAnalysis) {
    this.store.set(input.commandId, input);
    return input;
  }

  async findByCommandId(commandId: string) {
    return this.store.get(commandId) ?? null;
  }
}

EOF_7295911277020875884
mkdir -p "$ROOT/packages/automation/src/repositories"
cat > "$ROOT/packages/automation/src/repositories/execution-plan.repository.ts" <<'EOF_1648677384861371494'
import type { ExecutionPlan } from "../schemas/execution-plan.schema";

export class ExecutionPlanRepository {
  private readonly store = new Map<string, ExecutionPlan>();

  async save(input: ExecutionPlan) {
    this.store.set(input.commandId, input);
    return input;
  }

  async findByCommandId(commandId: string) {
    return this.store.get(commandId) ?? null;
  }
}

EOF_1648677384861371494
mkdir -p "$ROOT/packages/automation/src/repositories"
cat > "$ROOT/packages/automation/src/repositories/risk-assessment.repository.ts" <<'EOF_3058584181277396551'
import type { RiskAssessment } from "../schemas/risk-assessment.schema";

export class RiskAssessmentRepository {
  private readonly store = new Map<string, RiskAssessment>();

  async save(input: RiskAssessment) {
    this.store.set(input.commandId, input);
    return input;
  }

  async findByCommandId(commandId: string) {
    return this.store.get(commandId) ?? null;
  }
}

EOF_3058584181277396551
mkdir -p "$ROOT/packages/automation/src/repositories"
cat > "$ROOT/packages/automation/src/repositories/model-run.repository.ts" <<'EOF_5714681679701712527'
import type { ModelRun } from "../schemas/model-run.schema";

export class ModelRunRepository {
  private readonly store: ModelRun[] = [];

  async save(input: ModelRun) {
    this.store.push(input);
    return input;
  }

  async findByCommandId(commandId: string) {
    return this.store.filter((item) => item.commandId === commandId);
  }
}

EOF_5714681679701712527
mkdir -p "$ROOT/packages/automation/src/analysis"
cat > "$ROOT/packages/automation/src/analysis/intent-analyzer.service.ts" <<'EOF_7857327997914882066'
import type { LlmProvider } from "../providers/llm/base";
import { commandAnalysisSchema } from "../schemas/command-analysis.schema";
import type { CommandAnalysisRepository } from "../repositories/command-analysis.repository";
import type { ModelRunRepository } from "../repositories/model-run.repository";
import { classifyTask } from "../router/task-classifier";
import { routeModel } from "../router/model-router";
import { createTraceId } from "../core/utils/trace";

export class IntentAnalyzerService {
  constructor(
    private readonly llm: LlmProvider,
    private readonly repository: CommandAnalysisRepository,
    private readonly modelRunRepository: ModelRunRepository
  ) {}

  async analyze(input: { commandId: string; rawText: string }) {
    const task = classifyTask(input.rawText);
    const route = routeModel(task);
    const traceId = createTraceId();

    const completion = await this.llm.complete({
      model: route.model,
      system: "Analyze the command and return structured intent.",
      prompt: input.rawText
    });

    const parsed = commandAnalysisSchema.parse({
      commandId: input.commandId,
      summary: completion.text,
      intentType: "feature",
      domain: "automation",
      confidence: 0.81,
      riskPreview: "medium",
      recommendedWorkflow: ["analyze", "plan", "risk", "approve"],
      missingInfo: [],
      model: route.model,
      traceId
    });

    await this.repository.save(parsed);
    await this.modelRunRepository.save({
      commandId: input.commandId,
      phase: "intent",
      provider: route.provider,
      model: route.model,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      latencyMs: completion.usage.latencyMs,
      success: true,
      schemaValid: true,
      traceId
    });

    return parsed;
  }
}

EOF_7857327997914882066
mkdir -p "$ROOT/packages/automation/src/planning"
cat > "$ROOT/packages/automation/src/planning/execution-plan.service.ts" <<'EOF_9102109643575325469'
import type { LlmProvider } from "../providers/llm/base";
import type { ExecutionPlanRepository } from "../repositories/execution-plan.repository";
import type { ModelRunRepository } from "../repositories/model-run.repository";
import { executionPlanSchema } from "../schemas/execution-plan.schema";
import { createTraceId } from "../core/utils/trace";

export class ExecutionPlanService {
  constructor(
    private readonly llm: LlmProvider,
    private readonly repository: ExecutionPlanRepository,
    private readonly modelRunRepository: ModelRunRepository
  ) {}

  async generate(input: { commandId: string; rawText: string }) {
    const traceId = createTraceId();
    const completion = await this.llm.complete({
      model: "planner-v1",
      system: "Generate an execution plan.",
      prompt: input.rawText
    });

    const parsed = executionPlanSchema.parse({
      commandId: input.commandId,
      goalSummary: completion.text,
      impactedApps: ["apps/web"],
      impactedPackages: ["packages/automation", "packages/db"],
      expectedFiles: [
        "packages/automation/src/api/automation.facade.ts",
        "apps/web/src/app/api/automation/analyze/route.ts"
      ],
      dbChangeRequired: false,
      migrationRequired: false,
      testPlan: ["pnpm lint", "pnpm test", "pnpm build"],
      rollbackPlan: ["git revert commit", "disable feature flag"],
      approvalHints: ["human approval required before merge"],
      model: "planner-v1",
      traceId
    });

    await this.repository.save(parsed);
    await this.modelRunRepository.save({
      commandId: input.commandId,
      phase: "planning",
      provider: "mock",
      model: "planner-v1",
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      latencyMs: completion.usage.latencyMs,
      success: true,
      schemaValid: true,
      traceId
    });

    return parsed;
  }
}

EOF_9102109643575325469
mkdir -p "$ROOT/packages/automation/src/risk"
cat > "$ROOT/packages/automation/src/risk/risk-engine.service.ts" <<'EOF_2278689426155719765'
import type { RiskAssessmentRepository } from "../repositories/risk-assessment.repository";
import { riskAssessmentSchema } from "../schemas/risk-assessment.schema";
import { createTraceId } from "../core/utils/trace";

export class RiskEngineService {
  constructor(private readonly repository: RiskAssessmentRepository) {}

  async assess(input: {
    commandId: string;
    expectedFiles: string[];
    dbChangeRequired: boolean;
    migrationRequired: boolean;
  }) {
    const traceId = createTraceId();
    const level = input.migrationRequired || input.dbChangeRequired ? "high" : input.expectedFiles.length > 3 ? "medium" : "low";

    const parsed = riskAssessmentSchema.parse({
      commandId: input.commandId,
      riskLevel: level,
      reasons: [
        input.dbChangeRequired ? "Database change detected." : "No database change detected.",
        input.migrationRequired ? "Migration required." : "No migration required."
      ],
      requiresHumanApproval: level !== "low",
      requiredReviewerRole: level === "high" ? "admin" : "lead",
      recommendedChecks: ["pnpm lint", "pnpm test", "pnpm build"],
      traceId
    });

    await this.repository.save(parsed);
    return parsed;
  }
}

EOF_2278689426155719765
mkdir -p "$ROOT/packages/automation/src/approvals"
cat > "$ROOT/packages/automation/src/approvals/approval-summary.service.ts" <<'EOF_4685605905499927785'
export class ApprovalSummaryService {
  build(input: {
    riskLevel: string;
    reasons: string[];
    recommendedChecks: string[];
  }) {
    return {
      summary: `Risk ${input.riskLevel}`,
      reasons: input.reasons,
      checklist: input.recommendedChecks
    };
  }
}

EOF_4685605905499927785
mkdir -p "$ROOT/packages/automation/src/github"
cat > "$ROOT/packages/automation/src/github/pr-draft.service.ts" <<'EOF_2362603034742661388'
import { prDraftSchema } from "../schemas/pr-draft.schema";

export class PrDraftService {
  create(input: { commandId: string; title: string; body: string; labels?: string[] }) {
    return prDraftSchema.parse({
      commandId: input.commandId,
      title: input.title,
      body: input.body,
      labels: input.labels ?? ["automation"]
    });
  }
}

EOF_2362603034742661388
mkdir -p "$ROOT/packages/automation/src/api"
cat > "$ROOT/packages/automation/src/api/automation.facade.ts" <<'EOF_4848099559375923160'
import type { AnalyzeCommandInput } from "./dto/analyze-command.input";
import type { GeneratePlanInput } from "./dto/generate-plan.input";
import type { AssessRiskInput } from "./dto/assess-risk.input";
import { IntentAnalyzerService } from "../analysis/intent-analyzer.service";
import { ExecutionPlanService } from "../planning/execution-plan.service";
import { RiskEngineService } from "../risk/risk-engine.service";

export class AutomationFacade {
  constructor(
    private readonly intentAnalyzer: IntentAnalyzerService,
    private readonly executionPlanner: ExecutionPlanService,
    private readonly riskEngine: RiskEngineService
  ) {}

  async analyzeCommand(input: AnalyzeCommandInput) {
    return this.intentAnalyzer.analyze(input);
  }

  async generateExecutionPlan(input: GeneratePlanInput) {
    return this.executionPlanner.generate(input);
  }

  async assessRisk(input: AssessRiskInput) {
    return this.riskEngine.assess(input);
  }
}

EOF_4848099559375923160
mkdir -p "$ROOT/packages/automation/src/api/dto"
cat > "$ROOT/packages/automation/src/api/dto/analyze-command.input.ts" <<'EOF_3882408344409410114'
export type AnalyzeCommandInput = { commandId: string; rawText: string };

EOF_3882408344409410114
mkdir -p "$ROOT/packages/automation/src/api/dto"
cat > "$ROOT/packages/automation/src/api/dto/generate-plan.input.ts" <<'EOF_6014442939325527025'
export type GeneratePlanInput = { commandId: string; rawText: string };

EOF_6014442939325527025
mkdir -p "$ROOT/packages/automation/src/api/dto"
cat > "$ROOT/packages/automation/src/api/dto/assess-risk.input.ts" <<'EOF_1412894631459254130'
export type AssessRiskInput = {
  commandId: string;
  expectedFiles: string[];
  dbChangeRequired: boolean;
  migrationRequired: boolean;
};

EOF_1412894631459254130
mkdir -p "$ROOT/packages/automation/src/api/dto"
cat > "$ROOT/packages/automation/src/api/dto/draft-pr.input.ts" <<'EOF_4874186102710818183'
export type DraftPrInput = {
  commandId: string;
  title: string;
  body: string;
  labels?: string[];
};

EOF_4874186102710818183
mkdir -p "$ROOT/packages/automation/src/providers/llm"
cat > "$ROOT/packages/automation/src/providers/llm/base.ts" <<'EOF_6136866829160683905'
export type LlmCompletion = {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
  };
};

export interface LlmProvider {
  complete(input: {
    model: string;
    system: string;
    prompt: string;
  }): Promise<LlmCompletion>;
}

EOF_6136866829160683905
mkdir -p "$ROOT/packages/automation/src/providers/llm"
cat > "$ROOT/packages/automation/src/providers/llm/mock.provider.ts" <<'EOF_3904178295158034386'
import type { LlmProvider } from "./base";

export class MockLlmProvider implements LlmProvider {
  async complete(input: { model: string; system: string; prompt: string }) {
    return {
      text: `[${input.model}] ${input.prompt}`,
      usage: {
        promptTokens: Math.ceil(input.prompt.length / 4),
        completionTokens: 32,
        latencyMs: 25
      }
    };
  }
}

EOF_3904178295158034386
mkdir -p "$ROOT/packages/automation/src/providers/llm"
cat > "$ROOT/packages/automation/src/providers/llm/openai-compatible.provider.ts" <<'EOF_753342443388449514'
import type { LlmProvider } from "./base";

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.openai.com/v1"
  ) {}

  async complete(input: { model: string; system: string; prompt: string }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt }
        ]
      })
    });

    const json = await response.json() as any;

    return {
      text: json.choices?.[0]?.message?.content ?? "",
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        latencyMs: 0
      }
    };
  }
}

EOF_753342443388449514
mkdir -p "$ROOT/packages/automation/src/providers/telemetry"
cat > "$ROOT/packages/automation/src/providers/telemetry/logger.ts" <<'EOF_7593581332597010419'
export const automationLogger = {
  info: (...args: unknown[]) => console.log("[automation]", ...args),
  error: (...args: unknown[]) => console.error("[automation]", ...args)
};

EOF_7593581332597010419
mkdir -p "$ROOT/packages/automation/src/prompts/intent"
cat > "$ROOT/packages/automation/src/prompts/intent/system.ts" <<'EOF_2617268091119165788'
export const INTENT_SYSTEM_PROMPT = `
You are the AIOS intent analyzer.
Return a concise structured understanding of the command.
`.trim();

EOF_2617268091119165788
mkdir -p "$ROOT/packages/automation/src/prompts/planning"
cat > "$ROOT/packages/automation/src/prompts/planning/system.ts" <<'EOF_4588359524444263448'
export const PLANNING_SYSTEM_PROMPT = `
You are the AIOS execution planner.
Return a concise actionable execution plan.
`.trim();

EOF_4588359524444263448
mkdir -p "$ROOT/packages/automation/src/core/types"
cat > "$ROOT/packages/automation/src/core/types/automation.ts" <<'EOF_5129203623327285103'
export type AutomationStage = "intent" | "planning" | "risk" | "approval" | "pr";

EOF_5129203623327285103
mkdir -p "$ROOT/packages/automation/src/core/types"
cat > "$ROOT/packages/automation/src/core/types/command.ts" <<'EOF_5556049906747368388'
export type AutomationCommand = {
  id: string;
  rawText: string;
  status: string;
  source?: string;
  createdBy?: string;
};

EOF_5556049906747368388
mkdir -p "$ROOT/packages/automation/src/core/types"
cat > "$ROOT/packages/automation/src/core/types/plan.ts" <<'EOF_1133788664611128639'
export type PlanImpact = {
  impactedApps: string[];
  impactedPackages: string[];
  expectedFiles: string[];
};

EOF_1133788664611128639
mkdir -p "$ROOT/packages/automation/src/core/types"
cat > "$ROOT/packages/automation/src/core/types/risk.ts" <<'EOF_1799048552645652096'
export type RiskLevel = "low" | "medium" | "high";

export type RiskContext = {
  level: RiskLevel;
  reasons: string[];
};

EOF_1799048552645652096
mkdir -p "$ROOT/packages/automation/src/core/types"
cat > "$ROOT/packages/automation/src/core/types/model.ts" <<'EOF_2511146677870924188'
export type ModelUsage = {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

EOF_2511146677870924188
mkdir -p "$ROOT/packages/automation/src/core/types"
cat > "$ROOT/packages/automation/src/core/types/github.ts" <<'EOF_6382981115978723231'
export type PullRequestDraft = {
  title: string;
  body: string;
  labels: string[];
};

EOF_6382981115978723231
mkdir -p "$ROOT/packages/automation/src/core/errors"
cat > "$ROOT/packages/automation/src/core/errors/automation-error.ts" <<'EOF_9048723249899630281'
export class AutomationError extends Error {}

EOF_9048723249899630281
mkdir -p "$ROOT/packages/automation/src/core/errors"
cat > "$ROOT/packages/automation/src/core/errors/schema-validation-error.ts" <<'EOF_8411736254212133197'
import { AutomationError } from "./automation-error";

export class SchemaValidationError extends AutomationError {}

EOF_8411736254212133197
mkdir -p "$ROOT/packages/automation/src/core/utils"
cat > "$ROOT/packages/automation/src/core/utils/id.ts" <<'EOF_2953869825843349196'
export function createId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

EOF_2953869825843349196
mkdir -p "$ROOT/packages/automation/src/core/utils"
cat > "$ROOT/packages/automation/src/core/utils/time.ts" <<'EOF_5165129136353455485'
export function nowIso() {
  return new Date().toISOString();
}

EOF_5165129136353455485
mkdir -p "$ROOT/packages/automation/src/core/utils"
cat > "$ROOT/packages/automation/src/core/utils/trace.ts" <<'EOF_7936634604470230320'
import { createId } from "./id";

export function createTraceId() {
  return createId("trace");
}

EOF_7936634604470230320
mkdir -p "$ROOT/packages/automation/src/tests/unit"
cat > "$ROOT/packages/automation/src/tests/unit/intent-analyzer.service.test.ts" <<'EOF_5237213119643421309'
import { describe, expect, it } from "vitest";
import { IntentAnalyzerService } from "../../analysis/intent-analyzer.service";
import { MockLlmProvider } from "../../providers/llm/mock.provider";
import { CommandAnalysisRepository } from "../../repositories/command-analysis.repository";
import { ModelRunRepository } from "../../repositories/model-run.repository";

describe("IntentAnalyzerService", () => {
  it("creates structured analysis", async () => {
    const service = new IntentAnalyzerService(
      new MockLlmProvider(),
      new CommandAnalysisRepository(),
      new ModelRunRepository()
    );

    const result = await service.analyze({
      commandId: "cmd_1",
      rawText: "Add approval summary view"
    });

    expect(result.commandId).toBe("cmd_1");
    expect(result.intentType).toBe("feature");
  });
});

EOF_5237213119643421309
mkdir -p "$ROOT/packages/db"
cat > "$ROOT/packages/db/README_AI_SCHEMA.md" <<'EOF_8052901576950861267'
# AIOS v1.0.2 DB Draft Schema

This folder contains draft persistence models for:
- command analyses
- execution plans
- risk assessments
- model runs
- registry modules / matches

Merge these into the existing DB layer instead of blindly replacing live schema files.

EOF_8052901576950861267
mkdir -p "$ROOT/packages/db/prisma"
cat > "$ROOT/packages/db/prisma/schema.aios-v1.0.2.prisma" <<'EOF_4596755619247802490'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Command {
  id          String             @id @default(cuid())
  rawText     String
  status      String             @default("created")
  source      String?
  createdBy   String?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  analyses        CommandAnalysis[]
  executionPlans  ExecutionPlan[]
  riskAssessments RiskAssessment[]
  modelRuns       ModelRun[]
}

model CommandAnalysis {
  id                  String   @id @default(cuid())
  commandId           String
  summary             String
  intentType          String
  domain              String
  confidence          Float
  missingInfo         Json
  recommendedWorkflow Json
  riskPreview         String
  model               String
  traceId             String
  createdAt           DateTime @default(now())

  command Command @relation(fields: [commandId], references: [id], onDelete: Cascade)

  @@index([commandId])
  @@index([domain])
  @@index([createdAt])
}

model ExecutionPlan {
  id                String   @id @default(cuid())
  commandId         String
  goalSummary       String
  impactedApps      Json
  impactedPackages  Json
  expectedFiles     Json
  dbChangeRequired  Boolean  @default(false)
  migrationRequired Boolean  @default(false)
  testPlan          Json
  rollbackPlan      Json
  approvalHints     Json
  model             String
  traceId           String
  createdAt         DateTime @default(now())

  command Command @relation(fields: [commandId], references: [id], onDelete: Cascade)

  @@index([commandId])
  @@index([createdAt])
}

model RiskAssessment {
  id                    String   @id @default(cuid())
  commandId             String
  riskLevel             String
  reasons               Json
  requiresHumanApproval Boolean  @default(true)
  requiredReviewerRole  String
  recommendedChecks     Json
  traceId               String
  createdAt             DateTime @default(now())

  command Command @relation(fields: [commandId], references: [id], onDelete: Cascade)

  @@index([commandId])
  @@index([riskLevel])
  @@index([createdAt])
}

model ModelRun {
  id               String   @id @default(cuid())
  commandId        String
  phase            String
  provider         String
  model            String
  promptTokens     Int      @default(0)
  completionTokens Int      @default(0)
  latencyMs        Int      @default(0)
  success          Boolean  @default(true)
  schemaValid      Boolean  @default(true)
  fallbackFrom     String?
  fallbackReason   String?
  traceId          String
  createdAt        DateTime @default(now())

  command Command @relation(fields: [commandId], references: [id], onDelete: Cascade)

  @@index([commandId])
  @@index([phase])
  @@index([createdAt])
}

model RegistryModule {
  id            String   @id @default(cuid())
  name          String
  category      String
  description   String
  filePaths     Json
  tags          Json
  usageExamples Json?
  riskTags      Json?
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  matches RegistryMatch[]

  @@index([category])
  @@index([active])
}

model RegistryMatch {
  id               String   @id @default(cuid())
  commandId        String
  registryModuleId String
  score            Float
  reasons          Json
  createdAt        DateTime @default(now())

  registryModule RegistryModule @relation(fields: [registryModuleId], references: [id], onDelete: Cascade)

  @@index([commandId])
  @@index([registryModuleId])
}

EOF_4596755619247802490
mkdir -p "$ROOT/packages/db/sql"
cat > "$ROOT/packages/db/sql/001_aios_v1_0_2.sql" <<'EOF_8521784667288289337'
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  source TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS command_analyses (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  domain TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  missing_info JSONB NOT NULL,
  recommended_workflow JSONB NOT NULL,
  risk_preview TEXT NOT NULL,
  model TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_command_analyses_command_id ON command_analyses(command_id);
CREATE INDEX IF NOT EXISTS idx_command_analyses_domain ON command_analyses(domain);
CREATE INDEX IF NOT EXISTS idx_command_analyses_created_at ON command_analyses(created_at);

CREATE TABLE IF NOT EXISTS execution_plans (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  goal_summary TEXT NOT NULL,
  impacted_apps JSONB NOT NULL,
  impacted_packages JSONB NOT NULL,
  expected_files JSONB NOT NULL,
  db_change_required BOOLEAN NOT NULL DEFAULT FALSE,
  migration_required BOOLEAN NOT NULL DEFAULT FALSE,
  test_plan JSONB NOT NULL,
  rollback_plan JSONB NOT NULL,
  approval_hints JSONB NOT NULL,
  model TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_plans_command_id ON execution_plans(command_id);
CREATE INDEX IF NOT EXISTS idx_execution_plans_created_at ON execution_plans(created_at);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL,
  reasons JSONB NOT NULL,
  requires_human_approval BOOLEAN NOT NULL DEFAULT TRUE,
  required_reviewer_role TEXT NOT NULL,
  recommended_checks JSONB NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_command_id ON risk_assessments(command_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_risk_level ON risk_assessments(risk_level);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created_at ON risk_assessments(created_at);

CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  schema_valid BOOLEAN NOT NULL DEFAULT TRUE,
  fallback_from TEXT,
  fallback_reason TEXT,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_runs_command_id ON model_runs(command_id);
CREATE INDEX IF NOT EXISTS idx_model_runs_phase ON model_runs(phase);
CREATE INDEX IF NOT EXISTS idx_model_runs_created_at ON model_runs(created_at);

CREATE TABLE IF NOT EXISTS registry_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  file_paths JSONB NOT NULL,
  tags JSONB NOT NULL,
  usage_examples JSONB,
  risk_tags JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registry_modules_category ON registry_modules(category);
CREATE INDEX IF NOT EXISTS idx_registry_modules_active ON registry_modules(active);

CREATE TABLE IF NOT EXISTS registry_matches (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  registry_module_id TEXT NOT NULL REFERENCES registry_modules(id) ON DELETE CASCADE,
  score DOUBLE PRECISION NOT NULL,
  reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registry_matches_command_id ON registry_matches(command_id);
CREATE INDEX IF NOT EXISTS idx_registry_matches_registry_module_id ON registry_matches(registry_module_id);

EOF_8521784667288289337
