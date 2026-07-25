/**
 * U075 — Performance Measurement Utilities
 */

export type SampleResult = {
  name: string;
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  warmupSamples: number;
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeSamples(name: string, raw: number[], warmup: number = 0): SampleResult {
  const samples = raw.slice(warmup).sort((a, b) => a - b);
  const sum = samples.reduce((s, v) => s + v, 0);
  return {
    name,
    samples,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    min: samples[0] ?? 0,
    max: samples[samples.length - 1] ?? 0,
    mean: samples.length > 0 ? sum / samples.length : 0,
    warmupSamples: warmup,
  };
}
