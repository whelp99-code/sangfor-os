import { describe, expect, it } from "vitest";
import { evaluateConnectorState } from "./connector-state";

describe("U070: connector-state unit tests", () => {
  it("evaluates unconfigured state when credentials are missing", () => {
    const res = evaluateConnectorState({
      connectorKey: "github",
      targetLabel: "GitHub Integration",
      hasCredentials: false,
      isEnabled: true,
    });
    expect(res.state).toBe("unconfigured");
    expect(res.configured).toBe(false);
  });

  it("evaluates disabled state when isEnabled is false", () => {
    const res = evaluateConnectorState({
      connectorKey: "github",
      targetLabel: "GitHub Integration",
      hasCredentials: true,
      isEnabled: false,
    });
    expect(res.state).toBe("disabled");
    expect(res.enabled).toBe(false);
  });

  it("evaluates connected state when lastHandshakeSuccess is true", () => {
    const res = evaluateConnectorState({
      connectorKey: "github",
      targetLabel: "GitHub Integration",
      hasCredentials: true,
      isEnabled: true,
      lastHandshakeSuccess: true,
      lastHandshakeAt: "2026-07-25T00:00:00Z",
    });
    expect(res.state).toBe("connected");
    expect(res.lastConnectedAt).toBe("2026-07-25T00:00:00Z");
  });
});
