#!/usr/bin/env node
/**
 * Live approval smoke for Slack, GitHub, and whelp99 safe tool call.
 * Default: --dry-run (409 pending only, no approve, no external fetch)
 * Execute: --execute (requires SLACK_WEBHOOK_URL, GITHUB_TOKEN, env smoke targets)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3110";

const execute = process.argv.includes("--execute");
const dryRun = !execute;

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

async function postJson(path, body, timeoutMs = 120_000) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function approve(approvalId) {
  return postJson("/api/approvals", {
    approvalId,
    status: "approved",
    resolvedBy: "live-smoke-script",
    resolution: "Phase 8 live approval smoke",
  });
}

async function smokeSlack() {
  console.log("\n=== Slack send ===");
  const pending = await postJson("/api/slack/send", {
    requestedBy: "live-smoke",
    text: `[AIOSv2] integration smoke ${new Date().toISOString()}`,
  });
  console.log("pending", pending.res.status, pending.data.approvalStatus ?? pending.data.error);
  if (pending.res.status !== 409 || !pending.data.approval?.id) {
    return { ok: false, step: "pending" };
  }
  if (dryRun) return { ok: true, step: "dry-run", approvalId: pending.data.approval.id };

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log("skip execute: SLACK_WEBHOOK_URL missing");
    return { ok: false, step: "env" };
  }
  await approve(pending.data.approval.id);
  const live = await postJson("/api/slack/send", {
    approvalId: pending.data.approval.id,
    requestedBy: "live-smoke",
    text: `[AIOSv2] LIVE smoke ${new Date().toISOString()}`,
  });
  console.log("live", live.res.status, live.data);
  return { ok: live.res.ok, step: "live" };
}

async function smokeGithub() {
  console.log("\n=== GitHub branch + PR ===");
  const owner = process.env.GITHUB_SMOKE_OWNER;
  const repo = process.env.GITHUB_SMOKE_REPO;
  const baseSha = process.env.GITHUB_SMOKE_BASE_SHA;
  const branch = `integration-smoke-${Date.now()}`;

  if (!owner || !repo || !baseSha) {
    console.log("skip: set GITHUB_SMOKE_OWNER, GITHUB_SMOKE_REPO, GITHUB_SMOKE_BASE_SHA");
    return { ok: dryRun, step: "env-config" };
  }

  const pending = await postJson("/api/github/branches", {
    requestedBy: "live-smoke",
    owner,
    repo,
    branch,
    baseSha,
  });
  console.log("branch pending", pending.res.status);
  if (pending.res.status !== 409 || !pending.data.approval?.id) {
    return { ok: false, step: "branch-pending" };
  }
  if (dryRun) return { ok: true, step: "dry-run", approvalId: pending.data.approval.id };

  if (!process.env.GITHUB_TOKEN) {
    console.log("skip execute: GITHUB_TOKEN missing");
    return { ok: false, step: "env" };
  }
  await approve(pending.data.approval.id);
  const branchLive = await postJson("/api/github/branches", {
    approvalId: pending.data.approval.id,
    requestedBy: "live-smoke",
    owner,
    repo,
    branch,
    baseSha,
  });
  console.log("branch live", branchLive.res.status);

  const prPending = await postJson("/api/github/pull-requests", {
    requestedBy: "live-smoke",
    owner,
    repo,
    title: `AIOSv2 integration smoke ${new Date().toISOString()}`,
    head: branch,
    base: "main",
    draft: true,
  });
  if (prPending.res.status !== 409) {
    return { ok: branchLive.res.ok, step: "pr-pending" };
  }
  await approve(prPending.data.approval.id);
  const prLive = await postJson("/api/github/pull-requests", {
    approvalId: prPending.data.approval.id,
    requestedBy: "live-smoke",
    owner,
    repo,
    title: prPending.data.approval?.target ?? `AIOSv2 smoke PR`,
    head: branch,
    base: "main",
    draft: true,
  });
  console.log("pr live", prLive.res.status, prLive.data);
  return { ok: branchLive.res.ok && prLive.res.ok, step: "live" };
}

async function smokeWhelp99() {
  console.log("\n=== whelp99 safe tool ===");
  const pending = await postJson("/api/whelp99/tools/call", {
    requestedBy: "live-smoke",
    name: "sangfor.products",
    arguments: {},
  });
  console.log("pending", pending.res.status);
  if (pending.res.status !== 409 || !pending.data.approval?.id) {
    return { ok: false, step: "pending" };
  }
  if (dryRun) return { ok: true, step: "dry-run", approvalId: pending.data.approval.id };

  if (!process.env.WHELP99_MCP_HTTP_URL) {
    console.log("skip execute: WHELP99_MCP_HTTP_URL missing");
    return { ok: false, step: "env" };
  }
  await approve(pending.data.approval.id);
  const live = await postJson("/api/whelp99/tools/call", {
    approvalId: pending.data.approval.id,
    requestedBy: "live-smoke",
    name: "sangfor.products",
    arguments: {},
  });
  console.log("live", live.res.status);
  return { ok: live.res.ok, step: "live" };
}

async function main() {
  console.log(`Portal: ${BASE}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);

  const results = {
    slack: await smokeSlack(),
    github: await smokeGithub(),
    whelp99: await smokeWhelp99(),
  };

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(results, null, 2));

  const allOk = Object.values(results).every((r) => r.ok);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
