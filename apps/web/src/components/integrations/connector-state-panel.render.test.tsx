import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectorStatePanel } from "./connector-state-panel";

describe("ConnectorStatePanel render tests", () => {
  it("renders connector state panel with badge", () => {
    const html = renderToStaticMarkup(createElement(ConnectorStatePanel, {
      state: {
        connectorKey: "github", targetLabel: "GitHub Integration", state: "connected",
        mode: "read_only", evidenceClass: "local", configured: true, enabled: true,
        lastCheckedAt: null, lastConnectedAt: null, safeErrorCode: null,
        capabilities: [], warnings: [],
      },
    }));
    expect(html).toContain("connector-state-panel");
    expect(html).toContain("GitHub Integration");
    expect(html).toContain("connected");
  });
});
