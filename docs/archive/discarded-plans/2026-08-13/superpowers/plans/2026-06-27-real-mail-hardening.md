# Real Mail Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real-mail ingestion and candidate approval reliable by fixing seed/bootstrap gaps, formalizing SQLite mail cache ingest, and suppressing internal/system/promotional senders before they become customer/opportunity candidates.

**Architecture:** Keep the production app flow unchanged: real mail data becomes `KnowledgeDocument` / `MailInsightThread`, then `MailDerivedCandidate`, then approved downstream CRM/proposal records with `MailEvidenceLink`. Add focused parsing/classification helpers in `packages/business/src/mail-candidates.ts`, formalize fixture/bootstrap seeding in `packages/db/prisma/seed.ts`, and make the external ingest script deterministic for the actual `.mail-intel/data.db` format. Avoid adding a new service or long-running daemon.

**Tech Stack:** TypeScript, pnpm workspaces, Prisma 6, Vitest, Next.js App Router route handlers, Node.js scripts, system `sqlite3` CLI for `.mail-intel/data.db` fallback.

## Global Constraints

- Work in `/Users/jmpark/Playground/sangfor-os` on branch `continue-mail-candidate-connection-ui` unless the user requests a different branch.
- Before editing files under `apps/web`, read the relevant guide in `apps/web/node_modules/next/dist/docs/`; for route handlers use `01-app/01-getting-started/15-route-handlers.md`.
- Follow TDD: write a failing test, verify RED, implement minimal code, verify GREEN.
- Do not send real mail, deploy, mutate production DBs, force push, or create release tags.
- Runtime verification may mutate the local Docker Postgres database only.
- Treat `/Users/jmpark/.mail-intel/data.db` as local real-mail cache data; do not commit copied mail contents or secrets.
- Preserve the existing successful approve/connect behavior and `MailEvidenceLink` semantics: contact/supporting_contact, customer/primary_outcome, opportunity/primary_outcome, proposal/proposal_source.
- Existing caveat: `pnpm lint` may fail repo-wide because some packages call `eslint` without a resolvable workspace binary; do not block this plan on lint unless the lint dependency issue is explicitly included.

---

## File Structure

- Modify: `scripts/ingest-mail-intelligence-to-knowledge.mjs`
  - Owns external Mail Intelligence analysis ingest and raw fallback ingest.
  - Must support both legacy `accounts.json` and actual SQLite `.mail-intel/data.db` cache.
  - Must print actionable source/fallback diagnostics.

- Create: `scripts/ingest-mail-intelligence-to-knowledge.test.mjs`
  - Node test file for pure helper behavior exported from the ingest script.
  - Tests SQLite row normalization, fallback source selection, and raw fallback candidate-generation flag behavior without reading private mail data.

- Modify: `packages/business/src/mail-candidates.ts`
  - Owns mail candidate classification, suppression, AI revalidation, and generation.
  - Add explicit system/promotional/internal sender filtering for legacy knowledge fallback documents.
  - Keep public functions stable: `generateMailDerivedCandidates`, `generateMailDerivedCandidatesHybrid`, `classifyMailCandidateDocument`, `classifyMailInsightThread`.

- Modify: `packages/business/src/mail-candidates.test.ts`
  - Add regression tests for newsletter/promotional/system/internal raw mail documents.
  - Add tests proving quote/demo/renewal real-mail-like content still becomes actionable.

- Modify: `packages/business/src/mail-candidate-connections.ts`
  - Owns approve/connect defaults and evidence summaries.
  - Ensure legacy fallback customer defaults use sender metadata email/domain when present.

- Modify: `packages/business/src/mail-candidate-connections.test.ts`
  - Add/keep regression for `legacyKnowledgeFallback` defaults: `client@samsung.com` -> customer `Samsung`, domain `samsung.com`, contact `Choi Client`.

- Create: `packages/db/prisma/seed.ts`
  - Provide deterministic local demo seed used by `pnpm db:seed`.
  - Seed only safe synthetic data and required baseline entities; never read `/Users/jmpark/.mail-intel`.

- Modify: `packages/db/package.json`
  - Keep `db:seed` command as `tsx prisma/seed.ts`; after creating seed file it should pass.

- Modify: `apps/web/src/app/api/mail-candidates/route.ts`
  - Ensure `legacyKnowledgeFallback` request body is parsed and passed to business functions.
  - Use App Router route handler patterns from local Next docs.

- Create or modify: `docs/12_VERIFICATION/real-mail-hardening-runbook.md`
  - Document how to run local Docker DB, schema push, seed, real-mail ingest with SQLite fallback, candidate generation, and browser verification.

---

### Task 1: Add a Working Local DB Seed

**Files:**
- Create: `packages/db/prisma/seed.ts`
- Test: command-level verification through `pnpm db:seed`

**Interfaces:**
- Produces: a deterministic `demo-project` row for downstream scripts that call `resolveProjectId("demo-project")`.
- Produces: optional synthetic baseline data only; no real mail data.

- [ ] **Step 1: Write the failing seed verification command**

Run:

```bash
pnpm db:seed
```

Expected before implementation:

```text
Cannot find module '/Users/jmpark/Playground/sangfor-os/packages/db/prisma/seed.ts'
```

- [ ] **Step 2: Create `packages/db/prisma/seed.ts`**

Write this file exactly, then adjust only if Prisma model names differ at implementation time:

```ts
import { prisma } from "../src/index";

async function main() {
  const project = await prisma.project.upsert({
    where: { slug: "demo-project" },
    update: {
      name: "Demo Project",
      description: "Local demo project for SANGFOR Partner OS verification.",
    },
    create: {
      slug: "demo-project",
      name: "Demo Project",
      description: "Local demo project for SANGFOR Partner OS verification.",
    },
  });

  await prisma.user.upsert({
    where: { email: "operator@sangfor-os.local" },
    update: { name: "Portal Operator" },
    create: {
      email: "operator@sangfor-os.local",
      name: "Portal Operator",
    },
  });

  await prisma.policyMemory.upsert({
    where: {
      projectId_memoryType_key: {
        projectId: project.id,
        memoryType: "internal_domain",
        key: "blro.co.kr",
      },
    },
    update: { label: "BLRO internal domain", active: true },
    create: {
      projectId: project.id,
      memoryType: "internal_domain",
      key: "blro.co.kr",
      label: "BLRO internal domain",
      active: true,
    },
  });

  await prisma.policyMemory.upsert({
    where: {
      projectId_memoryType_key: {
        projectId: project.id,
        memoryType: "system_sender_domain",
        key: "bill36524.com",
      },
    },
    update: { label: "Bill36524 system sender", active: true },
    create: {
      projectId: project.id,
      memoryType: "system_sender_domain",
      key: "bill36524.com",
      label: "Bill36524 system sender",
      active: true,
    },
  });

  console.log(`Seeded ${project.slug} (${project.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: Run seed command to verify GREEN**

Run:

```bash
pnpm db:seed
```

Expected:

```text
Seeded demo-project (...)
```

Exit code must be `0`.

- [ ] **Step 4: Re-run seed command to verify idempotency**

Run:

```bash
pnpm db:seed
```

Expected:

```text
Seeded demo-project (...)
```

Exit code must be `0`; no unique constraint failure.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed.ts packages/db/package.json
git commit -m "fix(db): add deterministic local seed"
```

---

### Task 2: Formalize SQLite Real-Mail Fallback Ingest

**Files:**
- Modify: `scripts/ingest-mail-intelligence-to-knowledge.mjs`
- Create: `scripts/ingest-mail-intelligence-to-knowledge.test.mjs`

**Interfaces:**
- Produces exported helpers from the script:
  - `normalizeSqliteMessageRow(row: Record<string, unknown>): Record<string, unknown>`
  - `selectRawFallbackSource({ accountsPath, sqlitePath }: { accountsPath: string; sqlitePath: string }): "accounts-json" | "sqlite"`
  - `buildCandidateRequestBody({ projectSlug, limit, legacyKnowledgeFallback }: { projectSlug: string; limit: number; legacyKnowledgeFallback: boolean }): Record<string, unknown>`
- Consumes system `sqlite3` only for runtime script execution; tests should not require private mail DB.

- [ ] **Step 1: Write failing tests for SQLite row normalization and fallback source selection**

Create `scripts/ingest-mail-intelligence-to-knowledge.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import {
  buildCandidateRequestBody,
  normalizeSqliteMessageRow,
  selectRawFallbackSource,
} from "./ingest-mail-intelligence-to-knowledge.mjs";

const existingAccounts = "/tmp/accounts.json";
const existingSqlite = "/tmp/data.db";

function fakeExists(path) {
  return path === existingSqlite;
}

describe("real mail ingest fallback helpers", () => {
  it("normalizes a .mail-intel SQLite message row into the raw mail shape", () => {
    expect(
      normalizeSqliteMessageRow({
        id: "msg006",
        subject: "RE: Product demo feedback",
        from_addr: "client@samsung.com",
        from_name: "Choi Client",
        received_at: "2026-06-20T06:00:00Z",
        body_preview: "Great demo! We want to proceed with 200 units. Can you send proposal?",
        category: null,
        urgency: null,
        sentiment: null,
        confidence: null,
        raw_json: null,
      }),
    ).toMatchObject({
      id: "msg006",
      subject: "RE: Product demo feedback",
      from: "client@samsung.com",
      fromName: "Choi Client",
      receivedAt: "2026-06-20T06:00:00Z",
      bodyPreview: "Great demo! We want to proceed with 200 units. Can you send proposal?",
      accountId: "mail-intel-sqlite",
      accountEmail: "client@samsung.com",
      aiEnhanced: false,
    });
  });

  it("selects SQLite fallback when accounts.json is absent and data.db exists", () => {
    expect(
      selectRawFallbackSource({
        accountsPath: existingAccounts,
        sqlitePath: existingSqlite,
        exists: fakeExists,
      }),
    ).toBe("sqlite");
  });

  it("passes legacyKnowledgeFallback to candidate generation for raw fallback", () => {
    expect(
      buildCandidateRequestBody({
        projectSlug: "demo-project",
        limit: 8,
        legacyKnowledgeFallback: true,
      }),
    ).toEqual({
      projectSlug: "demo-project",
      limit: 8,
      legacyKnowledgeFallback: true,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm exec vitest run scripts/ingest-mail-intelligence-to-knowledge.test.mjs
```

Expected before helper exports:

```text
FAIL ... does not provide an export named 'normalizeSqliteMessageRow'
```

- [ ] **Step 3: Export pure helper functions from `scripts/ingest-mail-intelligence-to-knowledge.mjs`**

Modify the script so top-level execution only happens when invoked directly, and add these exports:

```js
export function normalizeSqliteMessageRow(row) {
  const raw = parseJsonObject(row.raw_json);
  const from = row.from_addr || raw.from || raw.sender || "unknown";
  return {
    ...raw,
    id: String(row.id),
    subject: row.subject || raw.subject || "(no subject)",
    from,
    fromName: row.from_name || raw.fromName || raw.senderName || from,
    receivedAt: row.received_at || raw.receivedAt,
    bodyPreview: row.body_preview || raw.bodyPreview || raw.preview || "",
    body: raw.body || row.body_preview || "",
    accountId: raw.accountId || "mail-intel-sqlite",
    accountEmail: raw.accountEmail || from,
    revenueOpsTags: [row.category, row.urgency, row.sentiment].filter(Boolean),
    aiEnhanced: false,
    confidence: row.confidence ?? raw.confidence,
  };
}

export function selectRawFallbackSource({ accountsPath, sqlitePath, exists = existsSync }) {
  if (exists(accountsPath)) return "accounts-json";
  if (exists(sqlitePath)) return "sqlite";
  throw new Error(`no_supported_mail_cache_found:${accountsPath}:${sqlitePath}`);
}

export function buildCandidateRequestBody({ projectSlug, limit, legacyKnowledgeFallback }) {
  return { projectSlug, limit, legacyKnowledgeFallback };
}
```

Update `loadMessages()` to call `selectRawFallbackSource()` and `loadMessagesFromSqlite()` to call `normalizeSqliteMessageRow()`.

At the bottom, replace unconditional `main()` with:

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm exec vitest run scripts/ingest-mail-intelligence-to-knowledge.test.mjs
```

Expected:

```text
Test Files  1 passed
Tests  3 passed
```

- [ ] **Step 5: Run real ingest smoke with dry run**

Run:

```bash
MAIL_INTELLIGENCE_BASE_URL=http://127.0.0.1:9 \
MAIL_INGEST_RAW_FALLBACK=1 \
MAIL_INTELLIGENCE_ROOT=/Users/jmpark/.mail-intel \
MAIL_INGEST_LIMIT=3 \
DRY_RUN=1 \
node scripts/ingest-mail-intelligence-to-knowledge.mjs
```

Expected:

```text
cached messages: 3
raw fallback to ingest: <0-3>
PASS: mail intelligence AIOS workflow ingest complete
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest-mail-intelligence-to-knowledge.mjs scripts/ingest-mail-intelligence-to-knowledge.test.mjs
git commit -m "fix(mail): support sqlite real-mail ingest fallback"
```

---

### Task 3: Harden Legacy Mail Candidate Suppression

**Files:**
- Modify: `packages/business/src/mail-candidates.ts`
- Modify: `packages/business/src/mail-candidates.test.ts`

**Interfaces:**
- Consumes `classifyMailCandidateDocument(document, policy?)`.
- Produces unchanged return shape: `{ header, candidates, excluded }`.
- Adds suppression logic for raw knowledge documents before customer/project candidates are returned.

- [ ] **Step 1: Add failing tests for internal, newsletter, and system senders**

Append these tests to `packages/business/src/mail-candidates.test.ts` inside `describe("mail candidate classification", () => { ... })`:

```ts
it("suppresses internal domain raw mail fallback documents", () => {
  const result = classifyMailCandidateDocument({
    title: "Mail: [URGENT] Server is down - need immediate fix",
    body: [
      "From: Kim Ops",
      "Email: ops@blro.co.kr",
      "Received: 2026-06-20T09:15:00Z",
      "MessageId: msg001",
      "",
      "Production server crashed at 9am. All services down.",
    ].join("\n"),
    tags: ["mail-intelligence", "urgent", "critical"],
  });

  expect(result.candidates).toHaveLength(0);
  expect(result.excluded[0]?.entityRole).toBe("internal_company");
});

it("suppresses newsletter raw mail fallback documents", () => {
  const result = classifyMailCandidateDocument({
    title: "Mail: FW: Industry newsletter - June edition",
    body: [
      "From: Industry News",
      "Email: newsletter@industry.com",
      "Received: 2026-06-20T06:30:00Z",
      "MessageId: msg004",
      "",
      "June newsletter with industry updates.",
    ].join("\n"),
    tags: ["mail-intelligence"],
  });

  expect(result.candidates).toHaveLength(0);
  expect(result.excluded[0]?.reason).toContain("newsletter");
});

it("keeps actionable customer proposal raw mail documents", () => {
  const result = classifyMailCandidateDocument({
    title: "Mail: RE: Product demo feedback",
    body: [
      "From: Choi Client",
      "Email: client@samsung.com",
      "Received: 2026-06-20T06:00:00Z",
      "MessageId: msg006",
      "",
      "Great demo! We want to proceed with 200 units. Can you send proposal?",
    ].join("\n"),
    tags: ["mail-intelligence"],
  });

  expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
    expect.arrayContaining(["customer", "opportunity", "task"]),
  );
  expect(result.excluded).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @sangfor/business test -- src/mail-candidates.test.ts
```

Expected before implementation:

```text
FAIL ... suppresses internal domain raw mail fallback documents
FAIL ... suppresses newsletter raw mail fallback documents
```

- [ ] **Step 3: Implement minimal suppression helpers**

In `packages/business/src/mail-candidates.ts`, add helper functions near existing domain/policy helpers:

```ts
function isNewsletterLike(title: string, body: string, header: HeaderInfo) {
  const text = `${title}\n${body}\n${header.email ?? ""}`.toLowerCase();
  return (
    text.includes("newsletter") ||
    text.includes("unsubscribe") ||
    text.includes("no-reply") ||
    text.includes("noreply")
  );
}

function buildRawDocumentExclusion(
  title: string,
  body: string,
  header: HeaderInfo,
  policy: MailPolicyLookup,
): PolicyDecision | null {
  const domain = domainFromEmail(header.email ?? header.from);
  const participantDomains = domain ? [domain] : [];

  if (isSystemSenderDomain(domain, policy)) {
    return {
      decision: "exclude",
      entityRole: "system_sender",
      reason: `Excluded system sender domain: ${domain}`,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        { memoryType: "system_sender_domain", key: domain ?? "unknown" },
      ]),
      participantDomains,
    };
  }

  if (isInternalDomain(domain, policy)) {
    return {
      decision: "exclude",
      entityRole: "internal_company",
      reason: `Excluded internal sender domain: ${domain}`,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        { memoryType: "internal_domain", key: domain ?? "unknown" },
      ]),
      participantDomains,
    };
  }

  if (isNewsletterLike(title, body, header)) {
    return {
      decision: "exclude",
      entityRole: "system_sender",
      reason: "Excluded newsletter/promotional raw mail fallback document",
      matchedPolicyMemories: [],
      participantDomains,
    };
  }

  return null;
}
```

In `classifyMailCandidateDocument`, immediately after parsing `header`, call:

```ts
const exclusion = buildRawDocumentExclusion(document.title, document.body, header, policy);
if (exclusion) {
  return { header, candidates: [], excluded: [exclusion] };
}
```

Use the actual local variable names in the function.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @sangfor/business test -- src/mail-candidates.test.ts
```

Expected:

```text
src/mail-candidates.test.ts ... passed
```

- [ ] **Step 5: Run real ingest with `MAIL_INGEST_LIMIT=8` and verify suppression count**

Run:

```bash
MAIL_INTELLIGENCE_BASE_URL=http://127.0.0.1:9 \
MAIL_INGEST_RAW_FALLBACK=1 \
MAIL_INTELLIGENCE_ROOT=/Users/jmpark/.mail-intel \
MAIL_INGEST_LIMIT=8 \
node scripts/ingest-mail-intelligence-to-knowledge.mjs
```

Expected:

```text
PASS: mail intelligence AIOS workflow ingest complete
candidates suppressed: <non-zero>
```

Also confirm with a DB query that no new customer candidate is created for `newsletter@industry.com` or `ops@blro.co.kr` after this task.

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/mail-candidates.ts packages/business/src/mail-candidates.test.ts
git commit -m "fix(mail): suppress internal and newsletter fallback candidates"
```

---

### Task 4: Preserve Real-Mail Approve/Connect Defaults

**Files:**
- Modify: `packages/business/src/mail-candidate-connections.ts`
- Modify: `packages/business/src/mail-candidate-connections.test.ts`

**Interfaces:**
- Consumes `buildMailCandidateConnectionDefaults(candidate)`.
- Produces defaults with:
  - `customer.name` derived from metadata email domain when `legacyKnowledgeFallback === true`.
  - `customer.domain` derived from metadata email domain.
  - `contact.email` from metadata email if `sourceSender` has name only.

- [ ] **Step 1: Add or keep failing regression test**

Ensure this test exists in `packages/business/src/mail-candidate-connections.test.ts`:

```ts
it("uses sender email metadata for legacy mail fallback customer defaults", () => {
  const defaults = buildMailCandidateConnectionDefaults({
    id: "candidate-real-mail",
    candidateType: "opportunity",
    title: "Opportunity: Mail: RE: Product demo feedback",
    summary: "Email: client@samsung.com Great demo! We want to proceed with 200 units. Can you send proposal?",
    sourceSender: "Choi Client",
    sourceTitle: "Mail: RE: Product demo feedback",
    confidence: 69,
    metadata: {
      email: "client@samsung.com",
      legacyKnowledgeFallback: true,
      aiRevalidation: {
        decision: "needs_human_review",
        missingFields: ["customer/partner confirmation"],
        riskFlags: ["low_confidence"],
      },
    },
  });

  expect(defaults.customer.name).toBe("Samsung");
  expect(defaults.customer.domain).toBe("samsung.com");
  expect(defaults.contact).toEqual({
    name: "Choi Client",
    email: "client@samsung.com",
    role: "Mail requester",
  });
});
```

- [ ] **Step 2: Run test to verify RED if implementation is absent**

Run:

```bash
pnpm --filter @sangfor/business test -- src/mail-candidate-connections.test.ts
```

Expected without implementation:

```text
FAIL ... expected 'Mail: RE: Product demo feedback' to be 'Samsung'
```

If this already passes because the previous session implemented it, record it as already GREEN and do not rewrite code.

- [ ] **Step 3: Implement minimal defaults fix if needed**

In `packages/business/src/mail-candidate-connections.ts`, ensure these helpers exist:

```ts
function extractSender(sender?: string | null, fallbackEmail?: string | null) {
  const text = String(sender ?? "").trim();
  const fallback = String(fallbackEmail ?? "").trim().toLowerCase();
  const match = text.match(/^(.+?)\s*<([^>]+)>$/);
  const email = (match?.[2] ?? (text.includes("@") ? text : fallback)).trim().toLowerCase();
  const name = (match?.[1] ?? (text && !text.includes("@") ? text : email.split("@")[0]) ?? "Mail requester").trim();
  return { name: name || "Mail requester", email };
}

function companyNameFromDomain(domain?: string) {
  const label = domain?.split(".")[0]?.replace(/[-_]+/g, " ").trim();
  return label ? label.replace(/\b\w/g, (char) => char.toUpperCase()) : undefined;
}
```

And in `buildMailCandidateConnectionDefaults`:

```ts
const metadataEmail = typeof metadata.email === "string" ? metadata.email : undefined;
const sender = extractSender(candidate.sourceSender, metadataEmail);
const senderDomain = domainFromEmail(sender.email);
const domain = senderDomain ?? participantDomains[0];
const customerName = metadata.legacyKnowledgeFallback === true
  ? (companyNameFromDomain(domain) ?? title)
  : title;
```

Use `customerName` for `customer.name`.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm --filter @sangfor/business test -- src/mail-candidate-connections.test.ts
```

Expected:

```text
src/mail-candidate-connections.test.ts ... passed
```

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/mail-candidate-connections.ts packages/business/src/mail-candidate-connections.test.ts
git commit -m "fix(mail): derive real-mail customer defaults from sender domain"
```

---

### Task 5: Verify Next Route Handler Body Options

**Files:**
- Modify: `apps/web/src/app/api/mail-candidates/route.ts`
- Test: `packages/business/src/mail-candidates.test.ts` remains the business behavior test; route behavior is verified by runtime `fetch`.

**Interfaces:**
- Consumes request JSON body:
  - `limit?: number | string`
  - `hybrid?: boolean | "true"`
  - `legacyKnowledgeFallback?: boolean | "true"`
- Produces `NextResponse.json(result, { status: 201 })`.

- [ ] **Step 1: Read local Next route handler docs**

Run:

```bash
sed -n '13,60p' apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

Expected to confirm:

```text
Route Handlers allow you to create custom request handlers ... using Web Request and Response APIs.
export async function GET(request: Request) {}
```

- [ ] **Step 2: Ensure route parses legacy fallback option**

In `apps/web/src/app/api/mail-candidates/route.ts`, ensure this block exists:

```ts
const legacyKnowledgeFallback =
  body.legacyKnowledgeFallback === true || body.legacyKnowledgeFallback === "true";
const input = {
  limit: Number(body.limit ?? 50),
  legacyKnowledgeFallback,
};

const result = useHybrid
  ? await generateMailDerivedCandidatesHybrid(input)
  : await generateMailDerivedCandidates(input);
```

- [ ] **Step 3: Runtime probe the route**

With web app running at `http://localhost:3101`, run:

```bash
curl -s -X POST http://localhost:3101/api/mail-candidates \
  -H 'Content-Type: application/json' \
  -d '{"limit":8,"legacyKnowledgeFallback":true}' | jq '{created, skipped, scanned, suppressed}'
```

Expected:

```json
{
  "created": 0,
  "skipped": 1,
  "scanned": 0,
  "suppressed": 0
}
```

Exact numbers may vary with local DB state; command must return HTTP 201 JSON and must not return `generate_failed`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/mail-candidates/route.ts
git commit -m "fix(web): pass legacy mail fallback option to candidate generation"
```

---

### Task 6: Runtime Verify End-to-End with Real Mail

**Files:**
- Modify: `docs/12_VERIFICATION/real-mail-hardening-runbook.md`

**Interfaces:**
- Consumes local real mail cache at `/Users/jmpark/.mail-intel/data.db`.
- Consumes local web app at `http://localhost:3101`.
- Produces a repeatable verification report and runbook.

- [ ] **Step 1: Create runbook with exact commands**

Create `docs/12_VERIFICATION/real-mail-hardening-runbook.md`:

```md
# Real Mail Hardening Runbook

## Prerequisites

- Docker Desktop running.
- Local mail cache exists at `/Users/jmpark/.mail-intel/data.db`.
- Work from `/Users/jmpark/Playground/sangfor-os`.

## Start local services

```bash
pnpm docker:dev
pnpm db:push
pnpm db:seed
pnpm dev:web
```

## Ingest real mail cache through SQLite fallback

```bash
MAIL_INTELLIGENCE_BASE_URL=http://127.0.0.1:9 \
MAIL_INGEST_RAW_FALLBACK=1 \
MAIL_INTELLIGENCE_ROOT=/Users/jmpark/.mail-intel \
MAIL_INGEST_LIMIT=8 \
node scripts/ingest-mail-intelligence-to-knowledge.mjs
```

Expected:

```text
PASS: mail intelligence AIOS workflow ingest complete
```

## Browser verification

1. Open `http://localhost:3101/development/mail-candidates`.
2. Open an actionable real-mail opportunity candidate, e.g. product demo or quote request.
3. Confirm approve/connect defaults:
   - customer name from sender domain, e.g. `Samsung`.
   - customer domain, e.g. `samsung.com`.
   - contact name from sender display name.
   - contact email from metadata email.
4. Click `Approve and connect`.
5. Confirm redirect to `/proposals/<id>`.
6. Confirm proposal detail shows `Mail evidence` card.
7. Confirm customer and opportunity detail pages show `Mail evidence` card.

## DB verification

```bash
pnpm --filter @sangfor/db exec tsx -e '
import { prisma } from "./src/index.ts";
(async () => {
  const candidate = await prisma.mailDerivedCandidate.findFirstOrThrow({
    where: { status: "converted", metadata: { path: ["legacyKnowledgeFallback"], equals: true } },
    orderBy: { updatedAt: "desc" },
  });
  const links = await prisma.mailEvidenceLink.findMany({
    where: { mailDerivedCandidateId: candidate.id },
    orderBy: { targetEntityType: "asc" },
  });
  console.log(JSON.stringify({
    candidateId: candidate.id,
    status: candidate.status,
    createdEntityType: candidate.createdEntityType,
    links: links.map((link) => ({
      targetEntityType: link.targetEntityType,
      linkType: link.linkType,
    })),
  }, null, 2));
  await prisma.$disconnect();
})();
'
```

Expected links:

```text
contact/supporting_contact
customer/primary_outcome
opportunity/primary_outcome
proposal/proposal_source
```
```

- [ ] **Step 2: Run runtime verification commands**

Run:

```bash
pnpm docker:dev
pnpm db:push
pnpm db:seed
MAIL_INTELLIGENCE_BASE_URL=http://127.0.0.1:9 \
MAIL_INGEST_RAW_FALLBACK=1 \
MAIL_INTELLIGENCE_ROOT=/Users/jmpark/.mail-intel \
MAIL_INGEST_LIMIT=8 \
node scripts/ingest-mail-intelligence-to-knowledge.mjs
```

Expected:

```text
PASS: mail intelligence AIOS workflow ingest complete
```

- [ ] **Step 3: Browser verify with Playwright**

Use Playwright to navigate to:

```text
http://localhost:3101/development/mail-candidates
```

Open a real opportunity candidate and verify the form input values with:

```js
Array.from(document.querySelectorAll('input')).map((input) => ({
  type: input.type,
  checked: input.checked,
  value: input.value,
  disabled: input.disabled,
})).slice(0, 10)
```

Expected example:

```json
[
  { "value": "Samsung" },
  { "value": "samsung.com" },
  { "value": "Choi Client" },
  { "value": "client@samsung.com" }
]
```

- [ ] **Step 4: Click approve/connect and verify proposal**

Click:

```text
Approve and connect
```

Expected:

```text
Browser URL becomes /proposals/<id>
Proposal page shows Customer: <sender-domain company>
Proposal page shows Mail evidence
```

- [ ] **Step 5: Commit runbook**

```bash
git add docs/12_VERIFICATION/real-mail-hardening-runbook.md
git commit -m "docs(mail): add real-mail hardening runbook"
```

---

## Final Verification

After all tasks:

- [ ] Run focused business tests:

```bash
pnpm --filter @sangfor/business test -- src/mail-candidates.test.ts src/mail-candidate-connections.test.ts
```

Expected:

```text
Test Files ... passed
Tests ... passed
```

- [ ] Run DB seed verification:

```bash
pnpm db:seed
```

Expected exit code `0`.

- [ ] Run real mail ingest smoke:

```bash
MAIL_INTELLIGENCE_BASE_URL=http://127.0.0.1:9 \
MAIL_INGEST_RAW_FALLBACK=1 \
MAIL_INTELLIGENCE_ROOT=/Users/jmpark/.mail-intel \
MAIL_INGEST_LIMIT=8 \
node scripts/ingest-mail-intelligence-to-knowledge.mjs
```

Expected:

```text
PASS: mail intelligence AIOS workflow ingest complete
```

- [ ] Run browser verification:
  - Candidate detail approve/connect form renders.
  - Customer defaults come from sender metadata/domain.
  - Approve/connect redirects to proposal.
  - Proposal/customer/opportunity pages show `Mail evidence`.
  - Browser console has `0` errors.

- [ ] Optional broader gates if time permits:

```bash
pnpm typecheck
pnpm build
```

Expected exit code `0` for both.

---

## Self-Review

**Spec coverage:**
- `db:seed` missing file: Task 1.
- Actual `.mail-intel/data.db` SQLite support: Task 2.
- Candidate generation from raw fallback knowledge: Task 2 and Task 5.
- Newsletter/internal/system sender hardening: Task 3.
- Real-mail customer defaults bug: Task 4.
- Runtime/browser verification and runbook: Task 6.

**Placeholder scan:**
- No `TBD`, `TODO`, or unspecified “handle edge cases” placeholders remain.
- Every code-changing task includes exact files, code snippets, commands, and expected outputs.

**Type consistency:**
- `legacyKnowledgeFallback` is consistently named in script request body, route handler, and business schema.
- Evidence link names remain the existing values: `supporting_contact`, `primary_outcome`, `proposal_source`.
- Public business function names match current code: `generateMailDerivedCandidates`, `generateMailDerivedCandidatesHybrid`, `buildMailCandidateConnectionDefaults`.
