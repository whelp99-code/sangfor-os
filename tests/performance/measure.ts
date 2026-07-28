import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { calculateQuote, getRoiDashboard, startWorkflowRun } from "@sangfor/business";
import { prisma } from "@sangfor/db";
import { DEFAULT_WARMUP_SAMPLES, QUOTE_HTTP_SAMPLE_COUNT } from "./contracts";

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
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

export function computeSamples(name: string, raw: number[], warmup = 0): SampleResult {
  const samples = raw.slice(warmup).sort((left, right) => left - right);
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    name,
    samples,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    min: samples[0] ?? 0,
    max: samples.at(-1) ?? 0,
    mean: samples.length ? sum / samples.length : 0,
    warmupSamples: warmup,
  };
}

async function timedSamples(name: string, count: number, operation: (index: number) => Promise<void> | void, warmup = 5) {
  const samples: number[] = [];
  for (let index = 0; index < count + warmup; index += 1) {
    const started = performance.now();
    await operation(index);
    samples.push(performance.now() - started);
  }
  return computeSamples(name, samples, warmup);
}

async function fetchTimed(url: string, init: RequestInit = {}) {
  const started = performance.now();
  const response = await fetch(url, init);
  const body = await response.text();
  const bytes = Buffer.byteLength(body);
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url} returned ${response.status}: ${body}`);
  return { duration: performance.now() - started, bytes };
}

async function fetchCustomerPage(baseUrl: string, headers: Record<string, string>, query = "") {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/customers${query}`, { headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET /api/customers${query} returned ${response.status}: ${body}`);
  const parsed = JSON.parse(body) as { customers?: Array<{ id: string }>; nextCursor?: string | null };
  if (!Array.isArray(parsed.customers)) throw new Error("customer API response omitted customers");
  return { duration: performance.now() - started, bytes: Buffer.byteLength(body), ...parsed };
}

async function main() {
  const outputFile = process.env.PERF_RESULTS_FILE;
  const corpusFile = process.env.PERF_CORPUS_RECEIPT_FILE;
  const baseUrl = process.env.BASE_URL;
  const password = process.env.AUTH_DEMO_PASSWORD;
  const authEmail = process.env.PERF_AUTH_EMAIL;
  if (!outputFile || !corpusFile || !baseUrl || !password || !authEmail) throw new Error("PERF_RESULTS_FILE, PERF_CORPUS_RECEIPT_FILE, BASE_URL, AUTH_DEMO_PASSWORD and PERF_AUTH_EMAIL are required");
  const corpus = JSON.parse(readFileSync(corpusFile, "utf8"));

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: authEmail, password }),
  });
  if (!login.ok) throw new Error(`login returned ${login.status}: ${await login.text()}`);
  const { token } = await login.json() as { token: string };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const quoteInput = Array.from({ length: 12 }, (_, index) => ({ productName: `SKU-${index}`, quantity: index + 1, unitPrice: 10_000 + index, costPrice: 6_000 + index, discountPct: index % 5 }));
  const samples: Record<string, SampleResult> = {};
  samples["quote-kernel"] = await timedSamples("quote-kernel", 100, () => { calculateQuote(quoteInput); }, 10);
  samples["list-db"] = await timedSamples("list-db", 60, async () => {
    const rows = await prisma.customer.findMany({ where: { projectId: corpus.scope.projectId, archivedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50 });
    if (rows.length !== 50 || rows.some((row) => row.id === corpus.sentinels.foreignCustomerId || row.id === corpus.sentinels.archivedCustomerId)) throw new Error("bounded DB list leaked a sentinel or wrong count");
  });
  samples["list-api"] = await timedSamples("list-api", 30, async () => {
    const result = await fetchCustomerPage(baseUrl, headers);
    if (result.customers.length !== 50 || !result.nextCursor) throw new Error(`default customer page is not bounded to 50: ${result.customers.length}`);
    if (result.customers.some((row) => row.id === corpus.sentinels.foreignCustomerId || row.id === corpus.sentinels.archivedCustomerId)) throw new Error("customer API leaked a sentinel");
    if (result.bytes > 262_144) throw new Error(`customer payload ${result.bytes} exceeds 256KiB`);
  });
  const maxPage = await fetchCustomerPage(baseUrl, headers, "?first=100");
  if (maxPage.customers.length !== 100) throw new Error(`max customer page is not bounded to 100: ${maxPage.customers.length}`);
  const oversizedPage = await fetch(`${baseUrl}/api/customers?first=101`, { headers });
  if (oversizedPage.status !== 422) throw new Error(`customer first=101 must return 422, got ${oversizedPage.status}`);
  samples["quote-http"] = await timedSamples("quote-http", QUOTE_HTTP_SAMPLE_COUNT, async (index) => {
    const opportunityId = `u075-opportunity-${String(index + 1).padStart(4, "0")}`;
    await fetchTimed(`${baseUrl}/api/opportunities/${opportunityId}/quotes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ currency: "KRW", lines: [{ lineType: "service", quantity: 2, unitPrice: 5000 + index, discountPct: 0 }] }),
    });
  }, DEFAULT_WARMUP_SAMPLES);

  const roiDurations: number[] = [];
  const roiSizes: number[] = [];
  for (let index = 0; index < 25; index += 1) {
    const result = await fetchTimed(`${baseUrl}/api/dashboard/roi`, { headers });
    roiDurations.push(result.duration);
    roiSizes.push(result.bytes);
  }
  samples["roi-dashboard"] = computeSamples("roi-dashboard", roiDurations, 5);
  samples["roi-payload"] = computeSamples("roi-payload", roiSizes, 5);

  const workflowCaller = { userId: corpus.workflowRunnerId, sessionId: "u075-measure-session", scope: corpus.scope, mfaVerifiedAt: new Date() };
  const workflowStarted = performance.now();
  const individual: number[] = [];
  await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const started = performance.now();
    await startWorkflowRun({ workflowDefinitionId: corpus.workflowDefinitionId, idempotencyKey: `u075-workflow-${index}`, input: { index } }, workflowCaller);
    individual.push(performance.now() - started);
  }));
  const total = performance.now() - workflowStarted;
  samples["workflow-concurrency"] = computeSamples("workflow-concurrency", [total]);
  samples["workflow-individual"] = computeSamples("workflow-individual", individual);

  writeFileSync(outputFile, `${JSON.stringify(samples, null, 2)}\n`, { flag: "wx" });
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
