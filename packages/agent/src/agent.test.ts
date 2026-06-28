import { describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import type { AgentStep, AgentTool, LlmComplete, ToolExecutor } from "./types";

const TOOLS: AgentTool[] = [
  { name: "sangfor.products", description: "List products" },
  { name: "sangfor.rag_search", description: "Search docs", inputSchema: { query: "string" } },
  { name: "sangfor.apply_config", description: "Mutating tool" },
];

const SAFE = ["sangfor.products", "sangfor.rag_search"];

/** LLM stub that returns a scripted sequence of raw completions. */
function scriptedLlm(outputs: string[]): LlmComplete {
  let i = 0;
  return vi.fn(async () => outputs[Math.min(i++, outputs.length - 1)]);
}

const noopExec: ToolExecutor = vi.fn(async () => ({ result: {} }));

describe("runAgent", () => {
  it("completes immediately when the LLM returns a final action", async () => {
    const res = await runAgent({
      goal: "say hi",
      tools: TOOLS,
      llm: scriptedLlm(['{"action":"final","answer":"hello"}']),
      execute: noopExec,
      safeTools: SAFE,
    });
    expect(res.status).toBe("completed");
    expect(res.answer).toBe("hello");
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0].kind).toBe("final");
  });

  it("chains a tool call then finalizes, feeding the observation back", async () => {
    const execute = vi.fn<ToolExecutor>(async () => ({ result: { hits: ["NGAF guide"] } }));
    const res = await runAgent({
      goal: "find NGAF docs",
      tools: TOOLS,
      llm: scriptedLlm([
        '{"action":"tool","tool":"sangfor.rag_search","arguments":{"query":"NGAF"},"thought":"search"}',
        '{"action":"final","answer":"found it"}',
      ]),
      execute,
      safeTools: SAFE,
      now: (() => {
        let t = 1000;
        return () => (t += 5);
      })(),
    });
    expect(res.status).toBe("completed");
    expect(res.steps.map((s) => s.kind)).toEqual(["tool", "final"]);
    expect(execute).toHaveBeenCalledWith("sangfor.rag_search", { query: "NGAF" });
    expect(res.steps[0].observation).toEqual({ hits: ["NGAF guide"] });
    expect(res.steps[0].latencyMs).toBe(5);
  });

  it("blocks an unsafe tool and does not execute it", async () => {
    const execute = vi.fn<ToolExecutor>(async () => ({ result: {} }));
    const res = await runAgent({
      goal: "apply config",
      tools: TOOLS,
      llm: scriptedLlm(['{"action":"tool","tool":"sangfor.apply_config","arguments":{}}']),
      execute,
      safeTools: SAFE,
    });
    expect(res.status).toBe("blocked");
    expect(res.blockedTool).toBe("sangfor.apply_config");
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes an unsafe tool when allowUnsafe is set", async () => {
    const execute = vi.fn<ToolExecutor>(async () => ({ result: { applied: true } }));
    const res = await runAgent({
      goal: "apply config",
      tools: TOOLS,
      llm: scriptedLlm([
        '{"action":"tool","tool":"sangfor.apply_config","arguments":{}}',
        '{"action":"final","answer":"done"}',
      ]),
      execute,
      safeTools: SAFE,
      allowUnsafe: true,
    });
    expect(res.status).toBe("completed");
    expect(execute).toHaveBeenCalledWith("sangfor.apply_config", {});
  });

  it("stops at maxSteps when the model never finalizes", async () => {
    const execute = vi.fn<ToolExecutor>(async () => ({ result: {} }));
    const res = await runAgent({
      goal: "loop",
      tools: TOOLS,
      llm: scriptedLlm(['{"action":"tool","tool":"sangfor.products","arguments":{}}']),
      execute,
      safeTools: SAFE,
      maxSteps: 3,
    });
    expect(res.status).toBe("max_steps");
    expect(res.steps).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("records an error step on invalid JSON, then recovers", async () => {
    const res = await runAgent({
      goal: "recover",
      tools: TOOLS,
      llm: scriptedLlm(["not json at all", '{"action":"final","answer":"ok"}']),
      execute: noopExec,
      safeTools: SAFE,
    });
    expect(res.status).toBe("completed");
    expect(res.steps.map((s) => s.kind)).toEqual(["error", "final"]);
  });

  it("captures a tool error as an error step observation", async () => {
    const execute = vi.fn<ToolExecutor>(async () => ({
      error: "Tool not in safe whitelist",
      allowedTools: ["sangfor.products"],
    }));
    const res = await runAgent({
      goal: "err",
      tools: TOOLS,
      llm: scriptedLlm([
        '{"action":"tool","tool":"sangfor.rag_search","arguments":{"query":"x"}}',
        '{"action":"final","answer":"handled"}',
      ]),
      execute,
      safeTools: SAFE,
    });
    expect(res.steps[0].kind).toBe("error");
    expect(res.steps[0].observation).toMatchObject({ error: "Tool not in safe whitelist" });
    expect(res.status).toBe("completed");
  });

  it("invokes onStep for every recorded step", async () => {
    const seen: AgentStep[] = [];
    await runAgent({
      goal: "stream",
      tools: TOOLS,
      llm: scriptedLlm([
        '{"action":"tool","tool":"sangfor.products","arguments":{}}',
        '{"action":"final","answer":"done"}',
      ]),
      execute: noopExec,
      safeTools: SAFE,
      onStep: (s) => seen.push(s),
    });
    expect(seen.map((s) => s.kind)).toEqual(["tool", "final"]);
  });
});
