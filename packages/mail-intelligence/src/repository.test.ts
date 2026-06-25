import { describe, expect, it } from "vitest";

import type { MailMessageMeta, TaskCandidate } from "./contract";

describe("mail-intelligence contract", () => {
  it("exports contract shapes", () => {
    const msg: MailMessageMeta = {
      id: "1",
      subject: "Test",
      fromAddress: "a@b.com",
      receivedAt: new Date().toISOString(),
    };
    const task: TaskCandidate = {
      mailMessageId: "1",
      title: "Follow up",
      summary: "Summary",
      priority: "normal",
    };
    expect(msg.subject).toBe("Test");
    expect(task.priority).toBe("normal");
  });
});
