# Source-grounded support reply preview

This is a read-only, staged preview at `/support/{caseId}`. It creates an
extractive reply or a request for missing evidence. It does not call an LLM,
record an approved outcome, learn from the preview, send mail, ingest documents,
or call customer devices. No schema migration or new dependency is required.

## Five-line usage guide

1. Open a support case and use **출처 기반 답장 초안**.
2. Select the question type; enter the product code, known version, and a search question without customer names or device identifiers.
3. Renewal and service-letter requests produce a clarification draft until approved contract or issuance evidence is available.
4. Technical replies quote matching, explicitly public/customer-shareable official sources; unknown search quality, missing evidence, or conflicting captured bytes stops the draft.
5. Review the original sources and missing facts yourself; this preview provides no sending, approval, learning, or device-operation authority.

## HTTP contract

`POST /api/support/{caseId}/reply-draft` accepts exactly:

```json
{
  "topic": "kernel_patch",
  "query": "The technical question to search",
  "product": "HCI",
  "version": "the actual version to compare"
}
```

Topics are `renewal`, `service_letter`, `kernel_patch`, and `general`. The exact
version is required for a kernel/patch citation draft; absent values produce a
clarification instead. This is not a compatibility assessment or patch approval.
Scope and authority fields are never accepted from the body. The persisted
session and live `support.read` capability resolve the project; the case is read
through the canonical RLS transaction and its customer project filter. Foreign
and archived cases produce an opaque 404 before retrieval.
The support detail page now applies the same persisted-session, capability and
RLS case scope before rendering either the new preview or the existing panels.

Results distinguish `draft`, `needs_evidence`, `conflict`, and
`service_unavailable`. They always carry `humanReviewRequired: true` and
`customerSendAllowed: false`. Citation hashes identify the exact retrieved text;
they do not prove semantic relevance, freshness, or independent vendor approval.
Text, citations, and warnings are displayed as data, never executed.

Duplicate source/chunk identities use canonical HTTPS URLs. Conflicting captured
text, product/version, trust, or sharing provenance stops drafting before any
eligibility filtering, independent of result order. This byte/metadata check does
not resolve semantic disagreement between distinct chunks; human review remains
required.

## Provider integration is a prerequisite, not a completed live proof

The existing infra client still uses its configured operator-console endpoint.
This change neither configures credentials nor changes a runtime target.
No live upstream connection or authenticated RLS database was exercised here.

The current bundled engineer provider returns legacy arrays, local `filePath`
sources, and no trustworthy search diagnostics or sharing provenance. Such a
response remains `needs_evidence`; the adapter must never fabricate metadata to
make it pass. The separate Engineer MCP repository's diagnostic envelope alone
is also insufficient without curated sharing provenance and a document link.

A citation-producing provider response must contain:

- `diagnostics.degraded: false` and `searchMode: semantic` or `bm25`, with no
  outstanding `evidenceRequirement`
- Chunk `id`, `title`, exact `text`, matching `product`, and matching `version`
  when a version was requested
- `trustLevel: official`, **explicit** `sourceVisibility: public`, and
  **explicit** `customerShareable: true`, assigned by a trusted source-curation
  process. A vendor hostname or an official label does not establish publicity
- A canonical Sangfor HTTPS document URL. Local paths, credential URLs,
  query/fragment URLs, ONE/portal/login paths, and private-copy markers are refused

The consumer hashes exact returned text. If an upstream supplies `textSha256`,
the adapter verifies it. It preserves absent visibility/sharing fields as absent,
keeps explicit false/restricted values, and rejects malformed fields. Do not
mark a private portal, authenticated download, customer document, quote, or
historical mail public merely to enable this preview. Providing production
curation or adding private-source ingestion is separate work.

## Verification

All new evidence fixtures are synthetic, including their source URLs and version
labels. They are not actual vendor compatibility or contract statements.

Focused checks use the existing workspace commands:

```sh
pnpm --filter @sangfor/infra test
pnpm --filter @sangfor/business test src/support/support-reply-draft.test.ts
pnpm --filter @sangfor/web test 'src/app/api/support/[id]/reply-draft/route.test.ts' src/components/support/support-reply-draft-panel.test.tsx src/lib/auth/authorization.test.ts src/lib/auth/route-capability-registry.test.ts
pnpm --filter @sangfor/web test src/app/api/engineer/rag/route.test.ts
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

The repository's full `pnpm verify:release` remains the authoritative release
gate. Focused tests do not substitute for live RLS, provider integration,
browser interaction, or the isolated Docker/PostgreSQL release proof.

## Existing page boundaries

The previous unscoped detail-page lookup is replaced with the preview's current
support capability and RLS scope, so an out-of-scope case cannot expose the new
reply controls or render the separate related-knowledge panel. The new API
transmits only explicit search input. Separately, the existing related-knowledge
panel still automatically submits the case subject after an authorized page
load. That legacy behavior predates this change and needs its own privacy review
before production use; it is not part of the manual-only preview contract. No
live customer case data was used for this preview work.
