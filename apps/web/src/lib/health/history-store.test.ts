import { describe, expect, it } from "vitest";

import { HealthHistoryStore, computeStats } from "./history-store";

describe("computeStats", () => {
  it("computes uptime % and average latency (excluding unreachable)", () => {
    const stats = computeStats("t", [
      { ts: "1", status: "healthy", latencyMs: 10 },
      { ts: "2", status: "healthy", latencyMs: 30 },
      { ts: "3", status: "unreachable" },
      { ts: "4", status: "degraded", latencyMs: 100 },
    ]);
    expect(stats.uptimePct).toBe(50); // 2/4 healthy
    expect(stats.avgLatencyMs).toBe(47); // (10+30+100)/3 rounded
    expect(stats.current).toBe("degraded");
    expect(stats.samples).toBe(4);
  });

  it("handles empty series", () => {
    const stats = computeStats("t", []);
    expect(stats.uptimePct).toBe(0);
    expect(stats.avgLatencyMs).toBeNull();
  });
});

describe("HealthHistoryStore", () => {
  it("records samples and detects healthiness flips", () => {
    const store = new HealthHistoryStore();
    expect(store.recordAndDetect([{ id: "a", status: "healthy", latencyMs: 5 }])).toEqual([]);
    // no flip yet (first sample), healthy→healthy = no flip
    expect(store.recordAndDetect([{ id: "a", status: "healthy" }])).toEqual([]);
    // healthy → unreachable = flip
    expect(store.recordAndDetect([{ id: "a", status: "unreachable" }])).toEqual([
      { id: "a", from: "healthy", to: "unreachable" },
    ]);
    // unreachable → degraded = no flip (both non-healthy)
    expect(store.recordAndDetect([{ id: "a", status: "degraded" }])).toEqual([]);
    // degraded → healthy = recovery flip
    expect(store.recordAndDetect([{ id: "a", status: "healthy" }])).toEqual([
      { id: "a", from: "degraded", to: "healthy" },
    ]);
  });

  it("caps the series length and exposes snapshots", () => {
    const store = new HealthHistoryStore();
    for (let i = 0; i < 80; i++) store.recordAndDetect([{ id: "a", status: "healthy", latencyMs: i }]);
    expect(store.getSeries("a").length).toBeLessThanOrEqual(60);
    const snap = store.snapshot();
    expect(snap[0].id).toBe("a");
    expect(snap[0].stats.uptimePct).toBe(100);
  });
});
