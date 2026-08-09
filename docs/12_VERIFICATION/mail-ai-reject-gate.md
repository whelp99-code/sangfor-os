# Q8 Gate 2 — AI-Rejected Candidate Revalidation

`pnpm verify:mail-ai-reject-gate -- --population <frozen-population.json> --reviews <reviews.json>` validates exact review coverage of a declared frozen manifest for AI-rejected project candidates. It reads only the two explicit JSON files. It does not connect to a database, inspect mail content, or resolve opaque evidence references.

## Population input

The population file is the frozen declaration of **all** AI rejects in one cycle. `schemaVersion` is exactly `mail-ai-reject-gate/v1`; `scope` is exactly `all_ai_rejects`; and `frozen` is exactly `true`. The immutable cycle metadata has a non-empty `cycleId` and `model`, at least one of `promptConfigId` or a 64-character hexadecimal `promptConfigHash`, and strict RFC3339-with-timezone `startedAt`/`endedAt` values (start no later than end). The validator independently checks the calendar date, clock fields, and timezone offset before parsing: it rejects rollover values such as month `13`, April `31`, a non-leap-year February `29`, `24:00:00`, and `+00:60`.

```json
{
  "schemaVersion": "mail-ai-reject-gate/v1",
  "scope": "all_ai_rejects",
  "frozen": true,
  "cycle": {
    "cycleId": "2026-08-09-mail-rejects",
    "model": "approved-model-id",
    "promptConfigHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "startedAt": "2026-08-09T00:00:00Z",
    "endedAt": "2026-08-09T01:00:00Z"
  },
  "candidates": [
    {
      "candidateId": "opaque-candidate-id",
      "candidateType": "task",
      "aiDecision": "reject",
      "evidenceRef": "opaque-reference"
    }
  ]
}
```

Every candidate ID must be unique. Every row must have the exact AI decision `aiDecision: "reject"` (a manual or database status of `rejected` is not accepted), and `candidateType` is one of `task`, `opportunity`, or `poc`. There is no sample-size cap: the declared frozen population is a full census even when it contains more than 200 candidates. `evidenceRef` is opaque; the validator neither parses nor dereferences it.

## Input resource bounds

Each explicit input file is read as a bounded stream, with a maximum of **4 MiB (4,194,304 bytes)** and a **5-second** read deadline. The limit applies separately to the population and reviews files; the CLI still evaluates every row in an accepted, declared population rather than sampling it. A file exceeding either bound, a read timeout, an unreadable file, or malformed JSON produces the same single `INVALID` receipt and exit code `64` as other invalid input. Operators must retain a complete frozen manifest that fits this documented input contract; this local file check does not establish authenticated source completeness or a real production Gate 2 PASS.

### External source-origin prerequisite

This validator proves coverage only against the declared frozen manifest; it cannot prove that the manifest contained every source reject when it was created. Before running this gate, operators must obtain the population from the canonical authenticated cycle export or its signed/recorded receipt and retain that source-origin proof with the gate evidence. Source completeness is an external prerequisite, not a claim made by this CLI.

## Reviews input and review rule

The reviews file uses the same `schemaVersion`, repeats the exact `cycleId`, and contains `reviews`. Each review has an in-population `candidateId`, `reviewerRole` (`primary` or `secondary`), non-empty opaque `reviewerId`, one label, and optional opaque `evidenceRef`.

```json
{
  "schemaVersion": "mail-ai-reject-gate/v1",
  "cycleId": "2026-08-09-mail-rejects",
  "reviews": [
    {
      "candidateId": "opaque-candidate-id",
      "reviewerRole": "primary",
      "reviewerId": "reviewer-1",
      "label": "not_opportunity",
      "evidenceRef": "opaque-primary-evidence"
    }
  ]
}
```

The only labels are `actual_opportunity`, `not_opportunity`, and `insufficient_evidence`. Every census row requires exactly one primary review. Secondary reviews are required for every primary `actual_opportunity` or `insufficient_evidence` row, plus the first `ceil(10%)` primary `not_opportunity` rows ranked by ascending SHA-256 of `${cycleId}:${candidateId}` (ties by candidate ID). This is the minimum required subset: additional secondary reviews are allowed. A primary and every supplied secondary review for one row must have different `reviewerId` values and identical labels.

Duplicate candidate IDs, duplicate role reviews, and review rows outside the frozen population are invalid input. A structurally valid document with a missing primary or required secondary review is instead a blocked gate: it can be completed without replacing the declared frozen population.

## Receipt and exit codes

The command emits exactly one JSON receipt to stdout and uses these process codes:

| Result | Exit | Meaning |
| --- | ---: | --- |
| `PASS` | 0 | Exact full coverage; no opportunity labels or uncertainty. |
| `FAIL` | 1 | Either reviewer labeled any row `actual_opportunity`. |
| `BLOCKED` | 2 | Required coverage is missing, labels mismatch, or any label is `insufficient_evidence`. |
| `INVALID` | 64 | Usage/JSON/schema errors, duplicates, or extra review rows. |

AI-rejected rows are operationally closed after a passing gate. Force revalidation remains the recovery path when later evidence, policy change, or an incident requires the frozen cycle to be revisited; it must create a new frozen cycle rather than mutate this one.
