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

The output reports `candidates suppressed` for existing candidate rows that were moved to `knowledge_only`. New internal, system, newsletter, or promotional raw fallback documents may be excluded before candidate rows are created, so validate suppression with the DB query below rather than requiring a non-zero count on every run.

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

Use the candidate ID from the browser approval page or from the POST `/api/mail-candidates/[id]/connect` response. This avoids passing with stale evidence links from an older run.

```bash
CANDIDATE_ID=<approved-mail-derived-candidate-id> \
pnpm --filter @sangfor/db exec tsx -e '
import { prisma } from "./src/index.ts";
const candidateId = process.env.CANDIDATE_ID;
if (!candidateId) throw new Error("CANDIDATE_ID is required");
(async () => {
  const candidate = await prisma.mailDerivedCandidate.findFirstOrThrow({
    where: {
      id: candidateId,
      status: "converted",
      createdEntityType: "opportunity",
      metadata: { path: ["legacyKnowledgeFallback"], equals: true },
    },
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

## Suppression verification

Confirm suppressed senders do not remain as active approval-queue customer candidates. Historical rows may exist as `knowledge_only`, `converted`, or `rejected` from earlier manual validation runs; those are not active pending candidates.

```bash
pnpm --filter @sangfor/db exec tsx -e '
import { prisma } from "./src/index.ts";
(async () => {
  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: {
      candidateType: "customer",
      status: { in: ["proposed", "needs_revalidation"] },
      OR: [
        { sourceSender: { contains: "newsletter@industry.com" } },
        { sourceSender: { contains: "ops@blro.co.kr" } },
        { metadata: { path: ["email"], equals: "newsletter@industry.com" } },
        { metadata: { path: ["email"], equals: "ops@blro.co.kr" } },
      ],
    },
    select: { id: true, title: true, sourceSender: true, metadata: true },
  });
  console.log(JSON.stringify({ count: candidates.length, candidates }, null, 2));
  await prisma.$disconnect();
})();
'
```

Expected:

```json
{
  "count": 0,
  "candidates": []
}
```
