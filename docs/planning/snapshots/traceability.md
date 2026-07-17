# Sangfor OS System Refactor — 99-Row Traceability Matrix

This matrix is the canonical one-primary-owner/one-primary-test assignment for the 28 requirements and 71 acceptance rows. `AUTONOMOUS_LOCAL` means the row can be closed with repository, scratch-database, isolated-service, or staging-equivalent evidence. `MANUAL_EXTERNAL_PENDING` means the implementation and local rehearsal may pass, but the external action remains unapproved and cannot be reported as passed. `MANUAL_EXTERNAL_PASS` may be recorded only after explicit approval and retained external evidence.

Evidence root: `.omo/evidence/sangfor-system-refactor-2026-07-15/<unit>/attempt-<n>/`.

## Requirement rows (28)

| ID | Primary owner | Execution unit(s) | Primary test ID | Verification state/evidence |
|---|---|---|---|---|
| REQ-M1 | DB-01 | U010,U011,U012,U073 | T-DB-SCOPE-RLS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U073/attempt-<n>/` |
| REQ-M2 | SEC-01 | U002,U013,U014 | T-SEC-AUTH | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U014/attempt-<n>/` |
| REQ-M3 | SEC-02 | U015,U024 | T-SEC-RBAC | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U024/attempt-<n>/` |
| REQ-M4 | DB-01 | U016,U073 | T-DB-SCOPE-RLS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U073/attempt-<n>/` |
| REQ-M5 | AUD-01 | U021 | T-AUD | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U021/attempt-<n>/` |
| REQ-M6 | WF-01 | U019,U025,U028,U050 | T-WF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U050/attempt-<n>/` |
| REQ-M7 | APR-01 | U018,U022 | T-APR | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U022/attempt-<n>/` |
| REQ-M8 | ART-01 | U017,U023 | T-ART | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U023/attempt-<n>/` |
| REQ-M9 | CRM-01 | U032,U043 | T-CRM | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U043/attempt-<n>/` |
| REQ-M10 | QUAL-01 | U034,U045 | T-QUAL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U045/attempt-<n>/` |
| REQ-M11 | CAT-01 | U033,U044 | T-CAT | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U044/attempt-<n>/` |
| REQ-M12 | QTE-01 | U035,U047 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U047/attempt-<n>/` |
| REQ-M13 | QTE-01 | U035,U048 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U048/attempt-<n>/` |
| REQ-M14 | DLV-01 | U037,U051 | T-DLV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U051/attempt-<n>/` |
| REQ-M15 | DLV-01 | U037,U052 | T-DLV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U052/attempt-<n>/` |
| REQ-M16 | AIQ-01 | U041,U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| REQ-M17 | UX-01 | U060,U061,U062,U063,U064,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| REQ-M18 | OPS-01 | U067,U068,U069,U071 | T-OPS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U071/attempt-<n>/` |
| REQ-S1 | VND-01 | U036,U049 | T-VND | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U049/attempt-<n>/` |
| REQ-S2 | SUP-01 | U039,U056 | T-SUP | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U056/attempt-<n>/` |
| REQ-S3 | CAT-01 | U033,U046 | T-CAT | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U046/attempt-<n>/` |
| REQ-S4 | SUP-01 | U039,U056 | T-SUP | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U056/attempt-<n>/` |
| REQ-S5 | SUP-01 | U039,U057 | T-SUP | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U057/attempt-<n>/` |
| REQ-S6 | PPL-01 | U038,U053 | T-PPL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U053/attempt-<n>/` |
| REQ-S7 | GOV-01 | U042,U058,U059 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U059/attempt-<n>/` |
| REQ-S8 | UX-01 | U060,U065 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U065/attempt-<n>/` |
| REQ-S9 | OPS-01 | U009,U074 | T-OPS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U074/attempt-<n>/` |
| REQ-S10 | ROI-01 | U072 | T-ROI | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U072/attempt-<n>/` |

## Acceptance rows (71)

| ID | Primary owner | Execution unit(s) | Primary test ID | Verification state/evidence |
|---|---|---|---|---|
| AC-SEC-01 | SEC-01 | U002,U013 | T-SEC-AUTH | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U013/attempt-<n>/` |
| AC-SEC-02 | DB-01 | U016,U073 | T-DB-SCOPE-RLS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U073/attempt-<n>/` |
| AC-SEC-03 | DB-01 | U016,U073 | T-DB-SCOPE-RLS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U073/attempt-<n>/` |
| AC-SEC-04 | APR-01 | U022 | T-APR | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U022/attempt-<n>/` |
| AC-SEC-05 | APR-01 | U022 | T-APR | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U022/attempt-<n>/` |
| AC-SEC-06 | SEC-02 | U015 | T-SEC-RBAC | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U015/attempt-<n>/` |
| AC-SEC-07 | AUD-01 | U021 | T-AUD | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U021/attempt-<n>/` |
| AC-SEC-08 | DB-01 | U016,U073 | T-DB-SCOPE-RLS | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U073/attempt-<n>/` |
| AC-SEC-09 | GOV-01 | U058 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U058/attempt-<n>/` |
| AC-WF-01 | QUAL-01 | U045 | T-QUAL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U045/attempt-<n>/` |
| AC-WF-02 | CAT-01 | U046 | T-CAT | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U046/attempt-<n>/` |
| AC-WF-03 | QTE-01 | U048 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U048/attempt-<n>/` |
| AC-WF-04 | APR-01 | U022 | T-APR | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U022/attempt-<n>/` |
| AC-WF-05 | WF-01 | U025,U050 | T-WF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U050/attempt-<n>/` |
| AC-BIZ-01 | QUAL-01 | U045 | T-QUAL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U045/attempt-<n>/` |
| AC-BIZ-02 | QTE-01 | U047 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U047/attempt-<n>/` |
| AC-BIZ-03 | QTE-01 | U047 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U047/attempt-<n>/` |
| AC-BIZ-04 | QTE-01 | U048,U055 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-BIZ-05 | DLV-01 | U051 | T-DLV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U051/attempt-<n>/` |
| AC-BIZ-06 | DLV-01 | U052 | T-DLV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U052/attempt-<n>/` |
| AC-AI-01 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-AI-02 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-AI-03 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-AI-04 | QTE-01 | U047,U055 | T-QTE | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-AI-05 | SUP-01 | U057 | T-SUP | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U057/attempt-<n>/` |
| AC-UX-01 | UX-01 | U060,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| AC-UX-02 | UX-01 | U060,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| AC-UX-03 | UX-01 | U060,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| AC-UX-04 | UX-01 | U060,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| AC-UX-05 | UX-01 | U060,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| AC-UX-06 | UX-01 | U060,U065,U066 | T-UX | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-<n>/` |
| AC-PERF-01 | PERF-01 | U075 | T-PERF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U075/attempt-<n>/` |
| AC-PERF-02 | PERF-01 | U075 | T-PERF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U075/attempt-<n>/` |
| AC-PERF-03 | PERF-01 | U075 | T-PERF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U075/attempt-<n>/` |
| AC-PERF-04 | PERF-01 | U075 | T-PERF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U075/attempt-<n>/` |
| AC-PERF-05 | PERF-01 | U075 | T-PERF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U075/attempt-<n>/` |
| AC-PERF-06 | PERF-01 | U075 | T-PERF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U075/attempt-<n>/` |
| AC-DOD-01 | REL-01 | U007,U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-02 | REL-01 | U005,U007,U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-03 | REL-01 | U007,U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-04 | REL-01 | U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-05 | REL-01 | U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-06 | REL-01 | U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-07 | REL-01 | U076 | T-REL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/` |
| AC-DOD-08 | DOC-01 | U001 | T-DOC | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U001/attempt-<n>/` |
| AC-DOD-09 | REL-01 | U076 | T-REL | MANUAL_EXTERNAL_PENDING — `.omo/evidence/sangfor-system-refactor-2026-07-15/U076/attempt-<n>/manual-external-staging.json`; explicit approval is required before `MANUAL_EXTERNAL_PASS` |
| AC-V31-BIZOPS-01 | VND-01 | U049 | T-VND | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U049/attempt-<n>/` |
| AC-V31-BIZOPS-02 | VND-01 | U049 | T-VND | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U049/attempt-<n>/` |
| AC-V31-BIZOPS-03 | WF-01 | U050 | T-WF | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U050/attempt-<n>/` |
| AC-V31-BIZOPS-04 | DLV-01 | U051 | T-DLV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U051/attempt-<n>/` |
| AC-V31-BIZOPS-05 | DLV-01 | U052 | T-DLV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U052/attempt-<n>/` |
| AC-V31-BIZOPS-06 | SUP-01 | U056 | T-SUP | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U056/attempt-<n>/` |
| AC-V31-BIZOPS-07 | SUP-01 | U056 | T-SUP | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U056/attempt-<n>/` |
| AC-V31-BIZOPS-08 | PPL-01 | U053 | T-PPL | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U053/attempt-<n>/` |
| AC-V31-GOV-01 | GOV-01 | U058 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U058/attempt-<n>/` |
| AC-V31-GOV-02 | GOV-01 | U058 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U058/attempt-<n>/` |
| AC-V31-GOV-03 | GOV-01 | U058 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U058/attempt-<n>/` |
| AC-V31-GOV-04 | GOV-01 | U058 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U058/attempt-<n>/` |
| AC-V31-GOV-05 | GOV-01 | U058 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U058/attempt-<n>/` |
| AC-V31-GOV-06 | GOV-01 | U059 | T-GOV | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U059/attempt-<n>/` |
| AC-V31-AIQ-01 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-V31-AIQ-02 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-V31-AIQ-03 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-V31-AIQ-04 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-V31-AIQ-05 | AIQ-01 | U054,U055 | T-AIQ | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-<n>/` |
| AC-V31-AUTH-01 | SEC-01 | U014 | T-SEC-AUTH | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U014/attempt-<n>/` |
| AC-V31-AUTH-02 | SEC-01 | U013 | T-SEC-AUTH | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U013/attempt-<n>/` |
| AC-V31-AUTH-03 | SEC-01 | U013 | T-SEC-AUTH | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U013/attempt-<n>/` |
| AC-V31-AUTH-04 | SEC-01 | U014 | T-SEC-AUTH | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U014/attempt-<n>/` |
| AC-V31-AUTH-05 | SEC-02 | U015 | T-SEC-RBAC | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U015/attempt-<n>/` |
| AC-V31-AUTH-06 | APR-01 | U022,U024 | T-APR | AUTONOMOUS_LOCAL — `.omo/evidence/sangfor-system-refactor-2026-07-15/U024/attempt-<n>/` |

## State transition rule

- A row starts as its declared mode, not as PASS. Test workers attach command output, structured receipts, screenshots, database proofs, and cleanup receipts under the listed attempt directory.
- `AUTONOMOUS_LOCAL` closes only when the primary test reports strict PASS with no skipped, focused-only, retried, zero-test, or fake-green result.
- `MANUAL_EXTERNAL_PENDING` remains release-blocking. Only an explicitly approved external action with a retained receipt may transition the row to `MANUAL_EXTERNAL_PASS`.
