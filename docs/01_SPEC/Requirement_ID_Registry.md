# Canonical Requirement & Acceptance ID Registry

이 문서는 requirement/acceptance ID 해석의 제품 source of truth다. 소유권·실행 unit·closure·evidence token의 기계 판독 값은 [acceptance manifest](../12_VERIFICATION/acceptance-manifest.json)에 고정한다.

## Precedence

충돌 시 precedence는 canonical registry > canonical requirement/acceptance source > living reference > historical report 순이다.

- Canonical requirement source: [Requirements — MoSCoW](Requirements_MoSCoW.md)
- Canonical acceptance source: [Acceptance Criteria & Test Plan](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md)
- Machine ownership/evidence source: [acceptance manifest](../12_VERIFICATION/acceptance-manifest.json)
- Evidence receipt contract: [acceptance evidence schema](../12_VERIFICATION/acceptance-evidence.schema.json)

## Scope and exclusion

- 구현 분모는 REQ-M1–REQ-M18, REQ-S1–REQ-S10의 정확히 28개다.
- Acceptance 분모는 canonical acceptance ID 71개다.
- C1–C5, W1–W5는 아이디어/명시적 비범위이며 두 분모와 구현 backlog에서 제외한다.
- Canonical ID, human alias, legacy alias는 모두 전역 단일 매핑이다. 같은 alias를 둘 이상의 canonical ID에 재사용하지 않는다.

## Historical namespace

[2026-06-26 gap matrix](../reports/final-package-gap-matrix.md)의 M1–M15는 이 registry 이전의 서로 다른 분류다. legacy-gap:M1–legacy-gap:M15로만 지칭하며 현재 M1–M15나 REQ-M1–REQ-M15의 alias로 해석하지 않는다. 과거 판정은 보존하고 현재 의미는 아래 표만 따른다.

## Canonical aliases

| Canonical ID | Human alias | Legacy alias | Canonical source |
|---|---|---|---|
| REQ-M1 | M1 | legacy:req:M1 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M2 | M2 | legacy:req:M2 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M3 | M3 | legacy:req:M3 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M4 | M4 | legacy:req:M4 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M5 | M5 | legacy:req:M5 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M6 | M6 | legacy:req:M6 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M7 | M7 | legacy:req:M7 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M8 | M8 | legacy:req:M8 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M9 | M9 | legacy:req:M9 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M10 | M10 | legacy:req:M10 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M11 | M11 | legacy:req:M11 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M12 | M12 | legacy:req:M12 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M13 | M13 | legacy:req:M13 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M14 | M14 | legacy:req:M14 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M15 | M15 | legacy:req:M15 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M16 | M16 | legacy:req:M16 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M17 | M17 | legacy:req:M17 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-M18 | M18 | legacy:req:M18 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S1 | S1 | legacy:req:S1 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S2 | S2 | legacy:req:S2 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S3 | S3 | legacy:req:S3 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S4 | S4 | legacy:req:S4 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S5 | S5 | legacy:req:S5 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S6 | S6 | legacy:req:S6 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S7 | S7 | legacy:req:S7 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S8 | S8 | legacy:req:S8 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S9 | S9 | legacy:req:S9 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| REQ-S10 | S10 | legacy:req:S10 | [Requirements_MoSCoW.md](../01_SPEC/Requirements_MoSCoW.md) |
| AC-SEC-01 | SEC-01 | legacy:acceptance:SEC-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-02 | SEC-02 | legacy:acceptance:SEC-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-03 | SEC-03 | legacy:acceptance:SEC-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-04 | SEC-04 | legacy:acceptance:SEC-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-05 | SEC-05 | legacy:acceptance:SEC-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-06 | SEC-06 | legacy:acceptance:SEC-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-07 | SEC-07 | legacy:acceptance:SEC-07 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-08 | SEC-08 | legacy:acceptance:SEC-08 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-SEC-09 | SEC-09 | legacy:acceptance:SEC-09 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-WF-01 | WF-01 | legacy:acceptance:WF-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-WF-02 | WF-02 | legacy:acceptance:WF-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-WF-03 | WF-03 | legacy:acceptance:WF-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-WF-04 | WF-04 | legacy:acceptance:WF-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-WF-05 | WF-05 | legacy:acceptance:WF-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-BIZ-01 | BIZ-01 | legacy:acceptance:BIZ-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-BIZ-02 | BIZ-02 | legacy:acceptance:BIZ-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-BIZ-03 | BIZ-03 | legacy:acceptance:BIZ-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-BIZ-04 | BIZ-04 | legacy:acceptance:BIZ-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-BIZ-05 | BIZ-05 | legacy:acceptance:BIZ-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-BIZ-06 | BIZ-06 | legacy:acceptance:BIZ-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-AI-01 | AI-01 | legacy:acceptance:AI-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-AI-02 | AI-02 | legacy:acceptance:AI-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-AI-03 | AI-03 | legacy:acceptance:AI-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-AI-04 | AI-04 | legacy:acceptance:AI-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-AI-05 | AI-05 | legacy:acceptance:AI-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-UX-01 | UX-01 | legacy:acceptance:UX-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-UX-02 | UX-02 | legacy:acceptance:UX-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-UX-03 | UX-03 | legacy:acceptance:UX-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-UX-04 | UX-04 | legacy:acceptance:UX-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-UX-05 | UX-05 | legacy:acceptance:UX-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-UX-06 | UX-06 | legacy:acceptance:UX-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-PERF-01 | PERF-01 | legacy:acceptance:PERF-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-PERF-02 | PERF-02 | legacy:acceptance:PERF-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-PERF-03 | PERF-03 | legacy:acceptance:PERF-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-PERF-04 | PERF-04 | legacy:acceptance:PERF-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-PERF-05 | PERF-05 | legacy:acceptance:PERF-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-PERF-06 | PERF-06 | legacy:acceptance:PERF-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-01 | DOD-01 | legacy:acceptance:DOD-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-02 | DOD-02 | legacy:acceptance:DOD-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-03 | DOD-03 | legacy:acceptance:DOD-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-04 | DOD-04 | legacy:acceptance:DOD-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-05 | DOD-05 | legacy:acceptance:DOD-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-06 | DOD-06 | legacy:acceptance:DOD-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-07 | DOD-07 | legacy:acceptance:DOD-07 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-08 | DOD-08 | legacy:acceptance:DOD-08 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-DOD-09 | DOD-09 | legacy:acceptance:DOD-09 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-01 | V31-BIZOPS-01 | legacy:acceptance:V31-BIZOPS-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-02 | V31-BIZOPS-02 | legacy:acceptance:V31-BIZOPS-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-03 | V31-BIZOPS-03 | legacy:acceptance:V31-BIZOPS-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-04 | V31-BIZOPS-04 | legacy:acceptance:V31-BIZOPS-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-05 | V31-BIZOPS-05 | legacy:acceptance:V31-BIZOPS-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-06 | V31-BIZOPS-06 | legacy:acceptance:V31-BIZOPS-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-07 | V31-BIZOPS-07 | legacy:acceptance:V31-BIZOPS-07 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-BIZOPS-08 | V31-BIZOPS-08 | legacy:acceptance:V31-BIZOPS-08 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-GOV-01 | V31-GOV-01 | legacy:acceptance:V31-GOV-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-GOV-02 | V31-GOV-02 | legacy:acceptance:V31-GOV-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-GOV-03 | V31-GOV-03 | legacy:acceptance:V31-GOV-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-GOV-04 | V31-GOV-04 | legacy:acceptance:V31-GOV-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-GOV-05 | V31-GOV-05 | legacy:acceptance:V31-GOV-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-GOV-06 | V31-GOV-06 | legacy:acceptance:V31-GOV-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AIQ-01 | V31-AIQ-01 | legacy:acceptance:V31-AIQ-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AIQ-02 | V31-AIQ-02 | legacy:acceptance:V31-AIQ-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AIQ-03 | V31-AIQ-03 | legacy:acceptance:V31-AIQ-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AIQ-04 | V31-AIQ-04 | legacy:acceptance:V31-AIQ-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AIQ-05 | V31-AIQ-05 | legacy:acceptance:V31-AIQ-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AUTH-01 | V31-AUTH-01 | legacy:acceptance:V31-AUTH-01 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AUTH-02 | V31-AUTH-02 | legacy:acceptance:V31-AUTH-02 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AUTH-03 | V31-AUTH-03 | legacy:acceptance:V31-AUTH-03 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AUTH-04 | V31-AUTH-04 | legacy:acceptance:V31-AUTH-04 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AUTH-05 | V31-AUTH-05 | legacy:acceptance:V31-AUTH-05 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
| AC-V31-AUTH-06 | V31-AUTH-06 | legacy:acceptance:V31-AUTH-06 | [Acceptance_Criteria_Test_Plan.md](../08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) |
