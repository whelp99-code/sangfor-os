import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GroundTruthPreviewCard,
  type GroundTruthPreviewView,
} from "./ground-truth-preview-card";

const proposal = {
  changes: [
    {
      id: "candidate-1",
      title: "Customer: GSITM",
      from: "customer",
      to: "partner",
      entityKey: "gsitm",
      relationshipKeys: ["gsenc-dt:gsitm:channel"],
      evidence: [
        {
          relationshipKey: "gsenc-dt:gsitm:channel",
          businessProject: "GS건설 DT VDI",
          role: "channel_partner",
          evidenceTier: "A",
          sourceArtifactIds: ["purchase-invoice-1"],
        },
      ],
    },
    {
      id: "candidate-2",
      title: "Customer: 일에이엔",
      from: "customer",
      to: "partner",
      entityKey: "ilaen",
      relationshipKeys: ["halla-ims-sase:ilaen:channel"],
      evidence: [],
    },
  ],
  humanReview: [],
  unchanged: ["candidate-system"],
  writeOperationsPrevented: 2,
  scanned: 3,
  writesPerformed: 0,
} satisfies GroundTruthPreviewView;

describe("GroundTruthPreviewCard", () => {
  it("renders a proposal with provenance and measured zero-write safety", () => {
    const html = renderToStaticMarkup(
      createElement(GroundTruthPreviewCard, {
        candidateId: "candidate-1",
        manifestId: "blro-mail-ground-truth-2026-08-12-v1",
        preview: proposal,
      }),
    );

    expect(html).toContain("근거 대장 대조 (읽기 전용)");
    expect(html).toContain("재분류 제안");
    expect(html).toContain("현재 유형");
    expect(html).toContain("대장 근거 유형");
    expect(html).toContain("customer");
    expect(html).toContain("partner");
    expect(html).toContain("GS건설 DT VDI");
    expect(html).toContain("purchase-invoice-1");
    expect(html).toContain("0건 (미리보기 전용)");
    expect(html).toContain("검사 후보</p><p");
    expect(html).toContain(">3건</p>");
    expect(html).toContain(">2건</p>");
    expect(html).toContain('data-testid="gt-preview"');
  });

  it("renders a clear no-match state without mutation controls", () => {
    const html = renderToStaticMarkup(
      createElement(GroundTruthPreviewCard, {
        candidateId: "candidate-none",
        manifestId: "manifest-v1",
        preview: {
          changes: [],
          humanReview: [],
          unchanged: ["candidate-none"],
          writeOperationsPrevented: 0,
          scanned: 1,
          writesPerformed: 0,
        },
      }),
    );

    expect(html).toContain("대장 근거 없음");
    expect(html).toContain("기존 메일 근거로 판단");
    expect(html).toContain("0건 (미리보기 전용)");
    expect(html).not.toMatch(/승인 및 생성|적용하기/u);
  });

  it("renders a human-review conflict as a text-labelled status", () => {
    const html = renderToStaticMarkup(
      createElement(GroundTruthPreviewCard, {
        candidateId: "candidate-conflict",
        manifestId: "manifest-v1",
        preview: {
          changes: [],
          humanReview: [
            {
              id: "candidate-conflict",
              entityKey: "partner",
              reason: "conflicting_project_roles",
            },
          ],
          unchanged: [],
          writeOperationsPrevented: 0,
          scanned: 1,
          writesPerformed: 0,
        },
      }),
    );

    expect(html).toContain("역할 충돌 · 사람 검토 필요");
    expect(html).toContain('role="status"');
    expect(html).toContain("자동 판단을 중단");
  });

  it("degrades only the preview when the manifest is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(GroundTruthPreviewCard, {
        candidateId: "candidate-1",
        manifestId: null,
        preview: null,
      }),
    );

    expect(html).toContain("대조 불가");
    expect(html).toContain("승인 판단에는 영향이 없습니다");
    expect(html).not.toMatch(/ZodError|invalid_type|superRefine/u);
  });
});
