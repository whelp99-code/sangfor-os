#!/usr/bin/env node
/**
 * Bulk ingest AIOS knowledge documents into LightRAG.
 *
 * Prereq: LightRAG container healthy, AIOS web reachable for document list/detail.
 *
 * Usage:
 *   node scripts/ingest-knowledge-to-lightrag.mjs
 *   SOURCE=mail-intelligence node scripts/ingest-knowledge-to-lightrag.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTAL_BASE = process.env.BASE_URL || "http://localhost:3101";
const LIGHTRAG_BASE = (process.env.LIGHTRAG_BASE_URL || "http://localhost:9621").replace(
  /\/$/,
  "",
);
const SOURCE_FILTER = process.env.SOURCE || "";
const BATCH_SIZE = Math.max(1, Number(process.env.LIGHTRAG_INGEST_BATCH_SIZE || 5));
const TIMEOUT_MS = Math.max(5_000, Number(process.env.LIGHTRAG_TIMEOUT_MS || 120_000));
const DRY_RUN = process.env.DRY_RUN === "1";

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function ingestBatch(documents) {
  const texts = documents.map((doc) =>
    `${doc.title}\n\n${doc.body}`.slice(0, 100_000),
  );
  const file_sources = documents.map(
    (doc) => `aios-${doc.source || "knowledge"}-${doc.id}.txt`,
  );
  return fetchJson(`${LIGHTRAG_BASE}/documents/texts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, file_sources }),
  });
}


async function main() {
  console.log("=== Knowledge → LightRAG bulk ingest ===");
  console.log(`portal: ${PORTAL_BASE}`);
  console.log(`lightrag: ${LIGHTRAG_BASE}`);
  console.log(`batch size: ${BATCH_SIZE}, timeout: ${TIMEOUT_MS}ms`);
  if (SOURCE_FILTER) console.log(`source filter: ${SOURCE_FILTER}`);
  if (DRY_RUN) console.log("DRY_RUN enabled");

  const health = await fetchJson(`${LIGHTRAG_BASE}/health`, { method: "GET" });
  if (!health.ok) {
    console.error(`FAIL: LightRAG unhealthy (HTTP ${health.status})`);
    process.exit(1);
  }
  console.log("LightRAG health: OK");

  const list = await fetchJson(`${PORTAL_BASE}/api/knowledge`);
  if (!list.ok) {
    console.error(`FAIL: could not list knowledge (HTTP ${list.status})`);
    process.exit(1);
  }

  let documents = list.json?.documents || [];
  if (SOURCE_FILTER) {
    documents = documents.filter((doc) => doc.source === SOURCE_FILTER);
  }
  console.log(`documents to ingest: ${documents.length}`);

  if (documents.length === 0) {
    console.log("PASS: nothing to ingest");
    return;
  }

  if (DRY_RUN) {
    console.log("DRY_RUN complete");
    return;
  }

  const stats = { ok: 0, failed: 0, errors: [] };
  const batches = [];
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    batches.push(documents.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const res = await ingestBatch(batch);
    if (res.ok) {
      stats.ok += batch.length;
      console.log(
        `progress: batch ${i + 1}/${batches.length} (docs=${stats.ok}/${documents.length})`,
      );
      continue;
    }
    stats.failed += batch.length;
    if (stats.errors.length < 10) {
      stats.errors.push({
        batch: i + 1,
        size: batch.length,
        status: res.status,
        error: res.json?.message || res.json?.detail || res.json?.error || "ingest_failed",
      });
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`ingested: ${stats.ok}`);
  console.log(`failed: ${stats.failed}`);
  if (stats.errors.length) {
    console.log("sample errors:", JSON.stringify(stats.errors, null, 2));
  }

  const probe = await fetchJson(`${LIGHTRAG_BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Microsoft mail invoice",
      mode: "mix",
      stream: false,
      response_type: "Multiple Paragraphs",
    }),
  });
  if (probe.ok) {
    const answer = String(probe.json?.response || "").slice(0, 200);
    console.log(`query probe: ${answer || "(empty response)"}`);
  } else {
    console.log(`query probe failed: HTTP ${probe.status}`);
  }

  if (stats.failed > 0) process.exit(1);
  console.log("PASS: LightRAG bulk ingest complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
