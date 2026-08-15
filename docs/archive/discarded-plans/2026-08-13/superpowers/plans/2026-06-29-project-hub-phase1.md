# 프로젝트 허브 Phase 1 (통합 뷰 + 실데이터 손익) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트(Engagement)를 도메인 레인 코크핏으로 만들고, 재무(Invoice/Expense/TaxInvoice)를 engagementId로 연결해 **딜별 손익(매출−매입−비용)이 실제 숫자로** 보이게 한다. (읽기전용; 자율도·사람개입 쓰기는 Phase 2.)

**Architecture:** 재무 leaf 3테이블에 `engagementId?` 추가(허브 전용 축; 레거시 CFO는 FinanceProject 축 유지 → 이중집계 없음). 순수함수(P&L 계산, 아티팩트→도메인 매핑)를 분리·단위테스트하고, `getProjectHub(engagementId)`가 Engagement 관계 + engagementId 축 재무를 집계. 읽기전용 도메인 레인 UI로 `/projects/[id]` 확장. 실데이터 seed로 데모 가능하게.

**Tech Stack:** TypeScript, Prisma(@sangfor/db), @sangfor/business(ESM, vitest), Next.js(apps/web), 기존 CFO 테마(`apps/web/src/lib/cfo-theme.ts`).

## Global Constraints
- **단일 축**: 프로젝트 허브 손익은 `engagementId` 축만 집계. 레거시 CFO 페이지는 `FinanceProject` 축 유지. 한 뷰는 한 축만.
- **TaxInvoice는 `direction`으로 분리**: `'purchase'`=매입(원가), `'sales'`=매출(수익).
- **자율도/DomainDecisionLog 집계 없음** (Phase 1 범위 밖 — 정직한 사람-결정 데이터 없음).
- **MeetingNote는 다중도메인** → 도메인 매핑에서 `'common'`.
- 금액 정수 KRW. 스키마 변경은 **shadow-DB `migrate diff`로 마이그레이션 생성**(`migrate dev` 금지, `db push` 금지 — DEV_REFERENCE §3.G). Postgres docker `sangfor-postgres` @localhost:5434; psql URL은 `?schema=public` 제거.
- 통합테스트는 `CI_INTEGRATION=1`(공유DB 직렬 — `vitest.config.ts fileParallelism`), 생성 행만 정리(deleteMany({}) 금지). 단위테스트는 키 불필요.
- 테스트: `pnpm --filter @sangfor/business exec vitest run <path>`; web typecheck `pnpm --filter @sangfor/web exec tsc --noEmit`(무관 페이지 '/' '/development/improvements' 기존 에러 무시).
- DEFAULT project slug = `demo-project`.

---

### Task 1: 스키마 — 재무에 engagementId 연결 + 마이그레이션

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`model Invoice` 1462, `model Expense` 1482, `model TaxInvoice` 1570)
- Create: `packages/db/prisma/migrations/20260629140000_finance_engagement_link/migration.sql`

**Interfaces:**
- Produces: `Invoice.engagementId?`, `Expense.engagementId?`, `TaxInvoice.engagementId?` (nullable String, `@map("engagement_id")`, indexed).

- [ ] **Step 1: 세 모델에 컬럼 추가**

각 모델의 `@@map(...)` 줄 위에 추가 (Invoice/Expense/TaxInvoice 동일):
```prisma
  engagementId  String?  @map("engagement_id")

  @@index([engagementId])
```
(TaxInvoice는 이미 `@@map("finance_tax_invoices")` 앞에; Invoice는 `@@map("finance_invoices")` 앞; Expense는 `@@map("finance_expenses")` 앞.)

- [ ] **Step 2: prisma validate**

Run: `pnpm --filter @sangfor/db exec prisma validate`
Expected: "The schema ... is valid"

- [ ] **Step 3: shadow-DB로 마이그레이션 SQL 생성**

Run (repo 루트):
```bash
cd packages/db
DBURL=$(grep -hoE 'DATABASE_URL="?[^"]*' ../../.env | head -1 | sed -E 's/DATABASE_URL=//; s/"//g')
BASE=$(echo "$DBURL" | sed -E 's#\?.*$##'); MAINT=$(echo "$BASE" | sed -E 's#/[^/]*$#/postgres#'); SHADOW="$(echo "$BASE" | sed -E 's#/[^/]*$#/prisma_shadow_hub#')?schema=public"
psql "$MAINT" -c 'DROP DATABASE IF EXISTS prisma_shadow_hub;' -c 'CREATE DATABASE prisma_shadow_hub;'
mkdir -p prisma/migrations/20260629140000_finance_engagement_link
DATABASE_URL="$DBURL" pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW" --script > prisma/migrations/20260629140000_finance_engagement_link/migration.sql
cat prisma/migrations/20260629140000_finance_engagement_link/migration.sql
```
Expected SQL: 3× `ALTER TABLE "finance_*" ADD COLUMN "engagement_id" TEXT;` + 3× `CREATE INDEX`. (도메인 테이블 등 무관 변경이 섞여 나오면 본 컬럼/인덱스만 남기고 잘라낼 것.)

- [ ] **Step 4: 적용 + client 재생성 + 검증**

Run:
```bash
DATABASE_URL="$DBURL" pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW" --script
psql "$MAINT" -c 'DROP DATABASE IF EXISTS prisma_shadow_hub;'
pnpm --filter @sangfor/db db:push   # dev DB에 컬럼 반영(허용: additive nullable). 그 후 generate.
pnpm --filter @sangfor/db exec prisma generate
```
Expected: 두 번째 diff 직전 출력이 "empty migration" 이면 마이그레이션=스키마 일치. db push는 additive(비파괴)이므로 OK; generate "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260629140000_finance_engagement_link/
git commit -m "feat(db): link finance records to engagement (engagementId)"
```
(트레일러: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

### Task 2: 순수함수 — 딜 손익 계산 (domain-pnl.ts)

**Files:**
- Create: `packages/business/src/domain-pnl.ts`
- Test: `packages/business/src/domain-pnl.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PnlInput {
    invoices: { total: number }[];                    // 매출 인보이스
    expenses: { total: number }[];                     // 비용
    taxInvoices: { direction: string; totalAmount: number }[]; // direction 'purchase'|'sales'
  }
  export interface Pnl { revenue: number; purchase: number; expense: number; margin: number; marginPct: number; }
  export function computePnl(input: PnlInput): Pnl;
  ```

- [ ] **Step 1: 실패 테스트**

`domain-pnl.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computePnl } from './domain-pnl';

describe('computePnl', () => {
  it('revenue = sales invoices + sales tax invoices; cost = purchase tax invoices; margin = revenue - purchase - expense', () => {
    const r = computePnl({
      invoices: [{ total: 1_100_000 }],
      expenses: [{ total: 200_000 }],
      taxInvoices: [
        { direction: 'purchase', totalAmount: 572_000 },
        { direction: 'sales', totalAmount: 0 },
      ],
    });
    expect(r.revenue).toBe(1_100_000);
    expect(r.purchase).toBe(572_000);
    expect(r.expense).toBe(200_000);
    expect(r.margin).toBe(328_000);
    expect(r.marginPct).toBe(29.8); // round(328000/1100000*1000)/10
  });
  it('handles empty (0/0/0) without divide-by-zero', () => {
    const r = computePnl({ invoices: [], expenses: [], taxInvoices: [] });
    expect(r).toEqual({ revenue: 0, purchase: 0, expense: 0, margin: 0, marginPct: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sangfor/business exec vitest run src/domain-pnl.test.ts`
Expected: FAIL ("Cannot find module './domain-pnl'").

- [ ] **Step 3: 구현**

```ts
export interface PnlInput {
  invoices: { total: number }[];
  expenses: { total: number }[];
  taxInvoices: { direction: string; totalAmount: number }[];
}
export interface Pnl { revenue: number; purchase: number; expense: number; margin: number; marginPct: number; }

const sum = (ns: number[]) => ns.reduce((s, n) => s + (n || 0), 0);

export function computePnl(input: PnlInput): Pnl {
  const salesTaxInvoiceTotal = sum(
    input.taxInvoices.filter((t) => t.direction === 'sales').map((t) => t.totalAmount),
  );
  const revenue = sum(input.invoices.map((i) => i.total)) + salesTaxInvoiceTotal;
  const purchase = sum(
    input.taxInvoices.filter((t) => t.direction === 'purchase').map((t) => t.totalAmount),
  );
  const expense = sum(input.expenses.map((e) => e.total));
  const margin = revenue - purchase - expense;
  const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
  return { revenue, purchase, expense, margin, marginPct };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sangfor/business exec vitest run src/domain-pnl.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/domain-pnl.ts packages/business/src/domain-pnl.test.ts
git commit -m "feat(hub): per-deal P&L pure function (revenue-purchase-expense)"
```

---

### Task 3: 순수함수 — 아티팩트→도메인 매핑 + 레인 (artifact-domain-map.ts)

**Files:**
- Create: `packages/business/src/artifact-domain-map.ts`
- Test: `packages/business/src/artifact-domain-map.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DomainKey = 'marketing' | 'sales' | 'presales' | 'engineer' | 'cfo';
  export const DOMAIN_ORDER: DomainKey[]; // ['marketing','sales','presales','engineer','cfo']
  export type ArtifactKind = 'meetingNote' | 'proposal' | 'poc' | 'checklist' | 'invoice' | 'expense' | 'taxInvoice' | 'lead';
  // meetingNote는 다중도메인 → 'common'
  export function domainOfArtifact(kind: ArtifactKind): DomainKey | 'common';
  export interface LaneArtifact { kind: ArtifactKind; id: string; label: string; status?: string; }
  export interface DomainLane { domain: DomainKey; status: 'done' | 'active' | 'pending'; artifacts: LaneArtifact[]; }
  // 산출물 목록으로 5개 레인 구성. 마지막으로 산출물이 있는 도메인=active, 그 앞=done, 뒤=pending.
  export function buildLanes(artifacts: LaneArtifact[]): DomainLane[];
  ```

- [ ] **Step 1: 실패 테스트**

`artifact-domain-map.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { domainOfArtifact, buildLanes, DOMAIN_ORDER } from './artifact-domain-map';

describe('domainOfArtifact', () => {
  it('maps known artifact kinds to domains', () => {
    expect(domainOfArtifact('proposal')).toBe('presales');
    expect(domainOfArtifact('poc')).toBe('presales');
    expect(domainOfArtifact('checklist')).toBe('engineer');
    expect(domainOfArtifact('taxInvoice')).toBe('cfo');
    expect(domainOfArtifact('invoice')).toBe('cfo');
    expect(domainOfArtifact('lead')).toBe('marketing');
    expect(domainOfArtifact('meetingNote')).toBe('common');
  });
});
describe('buildLanes', () => {
  it('produces 5 lanes in order with status derived from where artifacts exist', () => {
    const lanes = buildLanes([
      { kind: 'lead', id: 'l1', label: 'KB 메일' },
      { kind: 'proposal', id: 'p1', label: '제안서 v2' },
    ]);
    expect(lanes.map((l) => l.domain)).toEqual(DOMAIN_ORDER);
    expect(lanes.find((l) => l.domain === 'marketing')!.status).toBe('done');
    expect(lanes.find((l) => l.domain === 'presales')!.status).toBe('active'); // last with artifacts
    expect(lanes.find((l) => l.domain === 'engineer')!.status).toBe('pending');
    expect(lanes.find((l) => l.domain === 'presales')!.artifacts).toHaveLength(1);
  });
  it('empty artifacts → all pending', () => {
    expect(buildLanes([]).every((l) => l.status === 'pending')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sangfor/business exec vitest run src/artifact-domain-map.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
export type DomainKey = 'marketing' | 'sales' | 'presales' | 'engineer' | 'cfo';
export const DOMAIN_ORDER: DomainKey[] = ['marketing', 'sales', 'presales', 'engineer', 'cfo'];
export type ArtifactKind =
  | 'meetingNote' | 'proposal' | 'poc' | 'checklist'
  | 'invoice' | 'expense' | 'taxInvoice' | 'lead';

const MAP: Record<ArtifactKind, DomainKey | 'common'> = {
  lead: 'marketing',
  meetingNote: 'common',
  proposal: 'presales',
  poc: 'presales',
  checklist: 'engineer',
  invoice: 'cfo',
  expense: 'cfo',
  taxInvoice: 'cfo',
};
export function domainOfArtifact(kind: ArtifactKind): DomainKey | 'common' {
  return MAP[kind];
}

export interface LaneArtifact { kind: ArtifactKind; id: string; label: string; status?: string; }
export interface DomainLane { domain: DomainKey; status: 'done' | 'active' | 'pending'; artifacts: LaneArtifact[]; }

export function buildLanes(artifacts: LaneArtifact[]): DomainLane[] {
  // 'common'(meetingNote)은 가장 이른 가능한 도메인(sales)에 임시 귀속해 표시.
  const byDomain = new Map<DomainKey, LaneArtifact[]>();
  for (const d of DOMAIN_ORDER) byDomain.set(d, []);
  for (const a of artifacts) {
    const d = domainOfArtifact(a.kind);
    const target: DomainKey = d === 'common' ? 'sales' : d;
    byDomain.get(target)!.push(a);
  }
  const lastIdx = DOMAIN_ORDER.reduce(
    (acc, d, i) => (byDomain.get(d)!.length > 0 ? i : acc),
    -1,
  );
  return DOMAIN_ORDER.map((domain, i) => ({
    domain,
    artifacts: byDomain.get(domain)!,
    status: i < lastIdx ? 'done' : i === lastIdx ? 'active' : 'pending',
  }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @sangfor/business exec vitest run src/artifact-domain-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/artifact-domain-map.ts packages/business/src/artifact-domain-map.test.ts
git commit -m "feat(hub): artifact→domain mapping + lane status (pure)"
```

---

### Task 4: 집계 서비스 — getProjectHub (project-hub.ts)

**Files:**
- Create: `packages/business/src/project-hub.ts`
- Modify: `packages/business/src/index.ts` (export)
- Test: `packages/business/src/project-hub.test.ts`

**Interfaces:**
- Consumes: `computePnl` (Task 2), `buildLanes`/`LaneArtifact`/`DomainLane` (Task 3), `getEngagementDetail` (existing `engagement-center.ts`), prisma.
- Produces:
  ```ts
  export interface ProjectHub {
    engagement: Awaited<ReturnType<typeof import('./engagement-center').getEngagementDetail>>;
    lanes: import('./artifact-domain-map').DomainLane[];
    pnl: import('./domain-pnl').Pnl;
  }
  export function getProjectHub(engagementId: string): Promise<ProjectHub | null>;
  ```

- [ ] **Step 1: 실패 테스트 (integration-gated)**

`project-hub.test.ts` — `apps/api/src/services/finance/cfo.integration.test.ts`의 게이팅/정리 패턴을 따른다:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@sangfor/db';
import { getProjectHub } from './project-hub';

const integration = process.env.CI_INTEGRATION === '1';
const TAG = '__hub_test__';
let engagementId = '';
let projectId = '';
let oppId = '';

describe.skipIf(!integration)('getProjectHub', () => {
  beforeAll(async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { slug: 'demo-project' } });
    projectId = project.id;
    const customer = await prisma.customer.create({ data: { projectId, name: TAG, status: 'active' } });
    const opp = await prisma.opportunity.create({ data: { projectId, title: TAG, stage: 'WON', customerId: customer.id } });
    oppId = opp.id;
    const eng = await prisma.engagement.create({ data: { opportunityId: opp.id, name: TAG, status: 'planned', customerId: customer.id } });
    engagementId = eng.id;
    // 매입 세금계산서(원가) + 매출 인보이스를 이 engagement에 배정
    await prisma.taxInvoice.create({ data: { direction: 'purchase', status: 'received', supplierCorpNum: '1', supplierName: '넥시아스', buyerCorpNum: '2', buyerName: '베를로', supplyAmount: 520000, vatAmount: 52000, totalAmount: 572000, issueDate: new Date(), engagementId } });
    await prisma.invoice.create({ data: { buyer: TAG, amount: 1000000, vat: 100000, total: 1100000, memo: TAG, engagementId } });
  });
  afterAll(async () => {
    await prisma.taxInvoice.deleteMany({ where: { engagementId } });
    await prisma.invoice.deleteMany({ where: { engagementId } });
    await prisma.engagement.deleteMany({ where: { id: engagementId } });
    await prisma.opportunity.deleteMany({ where: { id: oppId } });
    await prisma.customer.deleteMany({ where: { name: TAG, projectId } });
  });

  it('aggregates lanes + P&L for an engagement (engagementId axis)', async () => {
    const hub = await getProjectHub(engagementId);
    expect(hub).not.toBeNull();
    expect(hub!.pnl.revenue).toBe(1100000);
    expect(hub!.pnl.purchase).toBe(572000);
    expect(hub!.pnl.margin).toBe(528000);
    expect(hub!.lanes.find((l) => l.domain === 'cfo')!.artifacts.length).toBeGreaterThan(0);
  });

  it('returns null for unknown engagement', async () => {
    expect(await getProjectHub('nonexistent')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `CI_INTEGRATION=1 pnpm --filter @sangfor/business exec vitest run src/project-hub.test.ts`
Expected: FAIL ("Cannot find module './project-hub'").

- [ ] **Step 3: 구현**

```ts
import { prisma } from '@sangfor/db';
import { getEngagementDetail } from './engagement-center';
import { computePnl, type Pnl } from './domain-pnl';
import { buildLanes, type DomainLane, type LaneArtifact } from './artifact-domain-map';

export interface ProjectHub {
  engagement: Awaited<ReturnType<typeof getEngagementDetail>>;
  lanes: DomainLane[];
  pnl: Pnl;
}

export async function getProjectHub(engagementId: string): Promise<ProjectHub | null> {
  const engagement = await getEngagementDetail(engagementId);
  if (!engagement) return null;

  const [invoices, expenses, taxInvoices] = await Promise.all([
    prisma.invoice.findMany({ where: { engagementId } }),
    prisma.expense.findMany({ where: { engagementId } }),
    prisma.taxInvoice.findMany({ where: { engagementId } }),
  ]);

  const pnl = computePnl({ invoices, expenses, taxInvoices });

  const artifacts: LaneArtifact[] = [
    ...engagement.meetingNotes.map((m: any) => ({ kind: 'meetingNote' as const, id: m.id, label: m.title ?? '미팅', status: m.status })),
    ...engagement.generatedDocuments.map((d: any) => ({ kind: 'proposal' as const, id: d.id, label: d.title ?? '제안서', status: d.status })),
    ...engagement.pocProjects.map((p: any) => ({ kind: 'poc' as const, id: p.id, label: p.title ?? 'POC', status: p.status })),
    ...engagement.checklistItems.map((c: any) => ({ kind: 'checklist' as const, id: c.id, label: c.itemKey ?? '체크', status: c.status })),
    ...taxInvoices.map((t) => ({ kind: 'taxInvoice' as const, id: t.id, label: `${t.direction === 'purchase' ? '매입' : '매출'} ${t.supplierName}`, status: t.status })),
    ...invoices.map((i) => ({ kind: 'invoice' as const, id: i.id, label: `매출 ${i.buyer ?? ''}`, status: i.depositStatus })),
    ...expenses.map((e) => ({ kind: 'expense' as const, id: e.id, label: e.expenseName, status: undefined })),
  ];

  return { engagement, lanes: buildLanes(artifacts), pnl };
}
```

- [ ] **Step 4: export**

`packages/business/src/index.ts`에 추가(이웃 export 스타일 따라):
```ts
export * from './project-hub';
export * from './domain-pnl';
export * from './artifact-domain-map';
```

- [ ] **Step 5: 통과 확인**

Run: `CI_INTEGRATION=1 pnpm --filter @sangfor/business exec vitest run src/project-hub.test.ts`
Expected: PASS (2).

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/project-hub.ts packages/business/src/index.ts packages/business/src/project-hub.test.ts
git commit -m "feat(hub): getProjectHub aggregation (engagement + finance P&L + lanes)"
```

---

### Task 5: API 라우트 — /api/projects/[id]/hub

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/hub/route.ts`
- Test: (없음 — Next route; typecheck로 검증)

**Interfaces:**
- Consumes: `getProjectHub` (Task 4).
- Produces: `GET /api/projects/:id/hub` → `ProjectHub` JSON | 404.

- [ ] **Step 1: 구현**

```ts
import { getProjectHub } from '@sangfor/business';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hub = await getProjectHub(id);
  if (!hub) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(hub);
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @sangfor/web exec tsc --noEmit`
Expected: clean (무관 페이지 기존 에러 외 본 파일 무에러).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/projects/[id]/hub/route.ts
git commit -m "feat(hub): GET /api/projects/[id]/hub route"
```

---

### Task 6: UI — 프로젝트 상세를 도메인 레인 코크핏으로 확장

**Files:**
- Modify: `apps/web/src/app/(portal)/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `getProjectHub` (server component 직접 호출).

- [ ] **Step 1: 페이지 재작성 (읽기전용 코크핏)**

`page.tsx` 전체를 교체. 기존 `getEngagementDetail` 대신 `getProjectHub` 사용. 헤더(이름·고객·상태) + **도메인 파이프라인 바**(5도메인, status별 점) + **CFO 손익 스트립**(매출 inflow색 / 매입·비용 outflow색 / 마진) + **도메인 레인 5개**(각 레인의 artifacts 목록). CFO 테마(`@/lib/cfo-theme` 의 `CFO`) 색 사용. 금액은 `₩${(n??0).toLocaleString()}`.
```tsx
import { getProjectHub } from "@sangfor/business";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CFO } from "@/lib/cfo-theme";

type PageProps = { params: Promise<{ id: string }> };
const won = (n?: number) => `₩${(n ?? 0).toLocaleString()}`;
const DOMAIN_LABEL: Record<string, string> = { marketing: "마케팅", sales: "세일즈", presales: "프리세일즈", engineer: "엔지니어", cfo: "CFO" };
const DOT: Record<string, string> = { done: "●", active: "◐", pending: "○" };

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const hub = await getProjectHub(id);
  if (!hub) notFound();
  const { engagement, lanes, pnl } = hub;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: CFO.ink }}>{engagement!.name}</h1>
        <p className="text-muted-foreground">{(engagement as any).opportunity?.customer?.name ?? "고객 미연결"} · {engagement!.status}</p>
        <div className="mt-1 h-0.5 w-12" style={{ background: CFO.brass }} />
      </div>

      {/* 도메인 파이프라인 바 */}
      <div className="flex items-center gap-2 text-sm">
        {lanes.map((l, i) => (
          <span key={l.domain} className="flex items-center gap-2">
            <span style={{ color: l.status === "pending" ? CFO.muted : CFO.ink }}>{DOT[l.status]} {DOMAIN_LABEL[l.domain]}</span>
            {i < lanes.length - 1 && <span style={{ color: CFO.hairline }}>──▶</span>}
          </span>
        ))}
      </div>

      {/* CFO 손익 스트립 */}
      <Card>
        <CardHeader><CardTitle>딜 손익</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 tabular-nums">
            <div><div className="text-xs text-muted-foreground">매출</div><div style={{ color: CFO.inflow }}>{won(pnl.revenue)}</div></div>
            <div><div className="text-xs text-muted-foreground">매입</div><div style={{ color: CFO.outflow }}>{won(pnl.purchase)}</div></div>
            <div><div className="text-xs text-muted-foreground">비용</div><div style={{ color: CFO.outflow }}>{won(pnl.expense)}</div></div>
            <div><div className="text-xs text-muted-foreground">마진</div><div style={{ color: pnl.margin >= 0 ? CFO.inflow : CFO.outflow }}>{won(pnl.margin)} ({pnl.marginPct}%)</div></div>
          </div>
        </CardContent>
      </Card>

      {/* 도메인 레인 */}
      <div className="grid gap-4 md:grid-cols-2">
        {lanes.map((l) => (
          <Card key={l.domain}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{DOMAIN_LABEL[l.domain]}</CardTitle>
              <Badge variant="outline">{DOT[l.status]} {l.status}</Badge>
            </CardHeader>
            <CardContent>
              {l.artifacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">산출물 없음</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {l.artifacts.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span>{a.label}</span>
                      {a.status && <Badge variant="secondary">{a.status}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @sangfor/web exec tsc --noEmit`
Expected: 본 파일 무에러(무관 페이지 기존 에러 무시).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(portal)/projects/[id]/page.tsx"
git commit -m "feat(hub): project detail as domain-lane cockpit with deal P&L"
```

---

### Task 7: 실데이터 seed + 라이브 검증 (데모 가능하게)

**Files:**
- Create: `packages/db/scripts/seed-project-hub-demo.ts`

**Interfaces:**
- Consumes: prisma. 기존 실제 고객 + 실제 매입 세금계산서(넥시아스)를 한 Engagement에 묶는다.

- [ ] **Step 1: seed 스크립트 작성**

```ts
import { prisma } from '@sangfor/db';

async function main() {
  const project = await prisma.project.findFirstOrThrow({ where: { slug: 'demo-project' } });
  // 실제 고객 하나 선택(없으면 생성)
  const customer = (await prisma.customer.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } }))
    ?? (await prisma.customer.create({ data: { projectId: project.id, name: '데모 고객', status: 'active' } }));
  // 기회 → 엔게이지먼트 (force로 게이트 우회)
  const opp = await prisma.opportunity.create({ data: { projectId: project.id, title: `${customer.name} 데모 딜`, stage: 'WON', customerId: customer.id, amount: 1100000 } });
  const eng = await prisma.engagement.upsert({
    where: { opportunityId: opp.id },
    create: { opportunityId: opp.id, name: `${customer.name} 데모 딜`, status: 'planned', customerId: customer.id, projectId: project.id },
    update: {},
  });
  // 실제 넥시아스 매입 세금계산서 최대 3건을 이 engagement에 배정(원가)
  const purchases = await prisma.taxInvoice.findMany({ where: { direction: 'purchase', engagementId: null }, take: 3 });
  for (const t of purchases) {
    await prisma.taxInvoice.update({ where: { id: t.id }, data: { engagementId: eng.id } });
  }
  console.log('seeded engagement', eng.id, 'customer', customer.name, 'purchases linked', purchases.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행**

Run: `pnpm --filter @sangfor/db exec tsx scripts/seed-project-hub-demo.ts`
Expected: "seeded engagement <id> customer <name> purchases linked N" (N≥1 이상이면 손익 매입이 실데이터로 채워짐).

- [ ] **Step 3: 라이브 검증 (API)**

Run: `curl -sS "http://localhost:3101/api/projects/<engId>/hub"` (위 출력 id 사용)
Expected: JSON에 `pnl.purchase > 0`, `lanes`에 cfo 레인 artifacts 존재.

- [ ] **Step 4: 라이브 검증 (화면)**

`http://localhost:3101/projects/<engId>` 접속 → 도메인 파이프라인 바 + 딜 손익(매입 실수치) + 레인 렌더 확인. (dev 서버 기준; prod build는 기존 이슈.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/seed-project-hub-demo.ts
git commit -m "chore(hub): demo seed wiring a real engagement to purchase tax invoices"
```

---

## Self-Review
- **Spec coverage**: §3 모델연결(engagementId)→T1 ✓; §7 순수함수(pnl/매핑)→T2,T3 ✓; getProjectHub→T4 ✓; API→T5 ✓; UI 코크핏+손익→T6 ✓; 실데이터 seed→T7 ✓. 자율도/결정로그=의도적으로 제외(spec §4 정정) ✓.
- **Placeholder scan**: 모든 코드 스텝에 실제 코드 포함. UI는 전체 JSX 제공.
- **Type consistency**: `DomainKey`/`DomainLane`/`LaneArtifact`(T3) ↔ `getProjectHub`(T4) ↔ route(T5) ↔ page(T6) 일관. `Pnl`(T2) ↔ T4/T6 일관. `computePnl` 입력 `{total}`/`{direction,totalAmount}`는 실제 Invoice/Expense/TaxInvoice 컬럼명(total, totalAmount, direction)과 일치.
- **알려진 조정 포인트(구현 중 확인)**: getEngagementDetail의 정확한 관계 필드명(meetingNotes/generatedDocuments/pocProjects/checklistItems)·Engagement 생성 필수 컬럼·Opportunity/Customer 필수 컬럼은 실제 스키마에 맞춰 조정(테스트가 잡아냄). Invoice 모델의 `depositStatus` 존재는 기존 코드로 확인됨.
