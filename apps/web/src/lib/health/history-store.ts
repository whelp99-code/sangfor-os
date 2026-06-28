export interface HealthSample {
  ts: string;
  status: string;
  latencyMs?: number;
}

export interface TargetStats {
  id: string;
  current: string;
  uptimePct: number;
  avgLatencyMs: number | null;
  samples: number;
}

export interface Transition {
  id: string;
  from: string;
  to: string;
}

export interface ProbeInput {
  id: string;
  status: string;
  latencyMs?: number;
}

const MAX_SAMPLES = 60;

const isHealthy = (status: string) => status === "healthy";

/** Compute uptime % and average latency from a target's samples. */
export function computeStats(id: string, samples: HealthSample[]): TargetStats {
  const count = samples.length;
  const healthy = samples.filter((s) => isHealthy(s.status)).length;
  const latencies = samples
    .filter((s) => s.status !== "unreachable" && typeof s.latencyMs === "number")
    .map((s) => s.latencyMs as number);
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  return {
    id,
    current: samples[samples.length - 1]?.status ?? "unknown",
    uptimePct: count ? Math.round((healthy / count) * 1000) / 10 : 0,
    avgLatencyMs: avg,
    samples: count,
  };
}

/**
 * In-memory per-target health time-series (globalThis singleton, HMR-safe).
 * Records probe samples and detects healthiness flips (healthy ↔ not-healthy)
 * for alerting.
 */
export class HealthHistoryStore {
  private series = new Map<string, HealthSample[]>();

  /** Append a batch of probe results; return the healthiness-flip transitions. */
  recordAndDetect(targets: ProbeInput[], at: string = new Date().toISOString()): Transition[] {
    const transitions: Transition[] = [];
    for (const t of targets) {
      const arr = this.series.get(t.id) ?? [];
      const prev = arr[arr.length - 1]?.status;
      arr.push({ ts: at, status: t.status, latencyMs: t.latencyMs });
      while (arr.length > MAX_SAMPLES) arr.shift();
      this.series.set(t.id, arr);
      if (prev !== undefined && isHealthy(prev) !== isHealthy(t.status)) {
        transitions.push({ id: t.id, from: prev, to: t.status });
      }
    }
    return transitions;
  }

  getSeries(id: string): HealthSample[] {
    return this.series.get(id) ?? [];
  }

  stats(): TargetStats[] {
    return [...this.series.entries()].map(([id, samples]) => computeStats(id, samples));
  }

  snapshot(): Array<{ id: string; stats: TargetStats; series: HealthSample[] }> {
    return [...this.series.entries()].map(([id, samples]) => ({
      id,
      stats: computeStats(id, samples),
      series: samples,
    }));
  }
}

type GlobalWithStore = typeof globalThis & { __sangforHealthHistory?: HealthHistoryStore };

export const healthHistory: HealthHistoryStore = (() => {
  const g = globalThis as GlobalWithStore;
  g.__sangforHealthHistory ??= new HealthHistoryStore();
  return g.__sangforHealthHistory;
})();
