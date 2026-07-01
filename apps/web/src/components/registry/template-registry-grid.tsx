"use client";

import { useState } from "react";

type TemplateItem = {
  key: string;
  title: string;
  description: string;
  expectedContext: string[];
  structure: string;
};

const TEMPLATE_LIST: TemplateItem[] = [
  {
    key: "proposal-prd",
    title: "Proposal PRD",
    description: "Product requirements draft compiled from opportunity and proposal context.",
    expectedContext: ["Opportunity details", "Proposal / PRD draft", "Customer name / domain", "Partner status", "Knowledge citations", "Linked work tasks"],
    structure: `## Objective
[Feature request text]

## Opportunity context
[Opportunity summary, value, stage, source]

## Proposal context
[Proposal text, document reference]

## Customer & partner details
[Seeded or approved company domain/industry notes]`
  },
  {
    key: "poc-experiment-plan",
    title: "PoC Experiment Plan",
    description: "Assumptions, validation experiments, and verification checklist for PoC projects.",
    expectedContext: ["PoC project details", "Verification test checklists", "Knowledge references", "Linked tasks"],
    structure: `## PoC scope
[PoC checklist, pilot target, technical review]

## Experiments
1. Validate core assumptions from PoC requirements.
2. Run smoke tests on critical integration paths.
3. Capture evidence in result reports.`
  },
  {
    key: "dev-implementation-plan",
    title: "Development Implementation Plan",
    description: "Technical engineering checklist, task breakdowns, and developer handoffs.",
    expectedContext: ["Opportunity metadata", "Linked tasks list", "Implementation guidelines"],
    structure: `## Request
[Input summary, features]

## Context
[Linked business opportunity, customer constraints]

## Implementation notes
- Follow additive migrations and portal guardrails.
- No Mail OAuth/Graph/send/delete/move in portal body.`
  },
  {
    key: "bugfix-improvement-plan",
    title: "Bugfix / Improvement Plan",
    description: "Defect analysis, root-cause details, fix approach, and regression check criteria.",
    expectedContext: ["Incident context (Opp / PoC)", "Knowledge troubleshooting citations"],
    structure: `## Problem statement
[Error details, stack traces]

## Impact
[Linked project or customer impact]

## Fix approach
1. Reproduce and isolate root cause.
2. Apply minimal fix with regression tests.
3. Route through Phase 15 loop if recurring.`
  },
  {
    key: "release-closeout-plan",
    title: "Release Closeout Plan",
    description: "Pre-deployment operational verification criteria, checklist, and signoff instructions.",
    expectedContext: ["All linked context appendix", "Handoff validation commands"],
    structure: `## Release scope
[Production release features]

## Checklist
- [ ] CI verify + Secret Scan green
- [ ] route-smoke PASS
- [ ] daily-development-status updated
- [ ] Owner approval before production tag/deploy`
  }
];

export function TemplateRegistryGrid() {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card shadow-sm">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold tracking-tight">템플릿 레지스트리</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            멀티 에이전트 오케스트레이터가 컨텍스트 입력을 패킷화하는 데 사용하는 Phase 14 템플릿입니다.
          </p>
        </div>
        <div className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_LIST.map((template) => (
              <button
                key={template.key}
                onClick={() => setSelectedTemplate(template)}
                type="button"
                className="flex flex-col items-start text-left p-3 rounded-md border border-border hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="font-semibold text-xs text-primary font-mono select-none">
                  [{template.key}]
                </span>
                <span className="font-medium text-sm mt-1">{template.title}</span>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {template.description}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedTemplate && (
        <div className="rounded-md border border-border bg-card p-4 space-y-4 shadow-sm animate-in fade-in-50 duration-150">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-semibold text-sm">{selectedTemplate.title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{selectedTemplate.description}</p>
            </div>
            <button
              onClick={() => setSelectedTemplate(null)}
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground font-medium underline"
            >
              미리보기 닫기
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 text-xs">
            <div className="space-y-2">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                Expected Context Sections
              </span>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {selectedTemplate.expectedContext.map((ctx) => (
                  <li key={ctx}>{ctx}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                Structure Template
              </span>
              <pre className="p-2.5 rounded border border-border bg-muted text-[11px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed text-muted-foreground">
                {selectedTemplate.structure}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
