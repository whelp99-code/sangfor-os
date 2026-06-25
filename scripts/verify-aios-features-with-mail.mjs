#!/usr/bin/env node
/**
 * AIOS feature verification with mail + attachment sample data.
 * Prereq: docker postgres/redis, mail-intelligence :3010, AIOS web :3101
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIL_BASE = process.env.MAIL_OAUTH_BASE_URL || "http://localhost:3010";
const PORTAL_BASE = process.env.BASE_URL || "http://localhost:3101";
const REPORT_PATH =
  process.env.REPORT_PATH ||
  join(ROOT, "docs/reports/aios-feature-verification-with-mail-2026-06-01.md");

const results = [];

function record(feature, step, status, detail = "") {
  results.push({ feature, step, status, detail });
  const mark = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "○";
  console.log(`${mark} [${feature}] ${step}: ${status}${detail ? ` — ${detail}` : ""}`);
}

async function http(method, url, body) {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

async function checkRoute(feature, path, expectOk = true) {
  const res = await fetch(`${PORTAL_BASE}${path}`);
  const ok = res.status < 500 && (!expectOk || res.status < 400 || res.status === 401);
  record(
    feature,
    `GET ${path}`,
    ok ? "PASS" : "FAIL",
    `HTTP ${res.status}`,
  );
  return { status: res.status, ok };
}

/** @type {{ subject: string; from: string; attachmentNames: string[]; bodyPreview: string }} */
let mailSample = {
  subject: "Verification sample",
  from: "unknown@example.com",
  attachmentNames: [],
  bodyPreview: "",
};

async function collectMailSample() {
  const auth = await fetch(`${MAIL_BASE}/api/auth/microsoft/status`).then((r) => r.json());
  if (auth.status !== "connected") {
    record("Mail sample", "OAuth status", "FAIL", auth.status || "disconnected");
    return null;
  }
  record("Mail sample", "OAuth connected", "PASS", auth.email || "");

  const accounts = await fetch(`${MAIL_BASE}/api/accounts`).then((r) => r.json());
  const accountId = accounts.accounts?.[0]?.id || auth.accountId;
  if (!accountId) {
    record("Mail sample", "account id", "FAIL", "missing");
    return null;
  }

  const msgs = await fetch(
    `${MAIL_BASE}/api/outlook/messages?cacheOnly=0&top=25`,
  ).then((r) => r.json());
  const messages = msgs.messages || [];
  record("Mail sample", "live messages fetch", messages.length ? "PASS" : "FAIL", `count=${messages.length}`);

  let picked = null;
  let attachments = [];
  for (const m of messages) {
    if (!m.hasAttachments) continue;
    const attRes = await fetch(
      `${MAIL_BASE}/api/accounts/${accountId}/messages/${encodeURIComponent(m.id)}/attachments`,
    );
    const attJson = await attRes.json();
    const list = attJson.attachments || [];
    if (list.length > 0) {
      picked = m;
      attachments = list;
      break;
    }
  }
  if (!picked && messages[0]) {
    picked = messages[0];
  }
  if (!picked) {
    record("Mail sample", "pick message", "FAIL", "no messages");
    return null;
  }

  mailSample = {
    subject: String(picked.subject || "").slice(0, 200),
    from: String(picked.from || picked.fromEmail || "").slice(0, 120),
    attachmentNames: attachments.map((a) => a.name).slice(0, 10),
    bodyPreview: String(picked.bodyPreview || "").slice(0, 300),
  };
  record(
    "Mail sample",
    "message with attachments",
    attachments.length ? "PASS" : "PARTIAL",
    `${attachments.length} files: ${mailSample.attachmentNames.join(", ") || "none"}`,
  );

  const arch = await fetch(`${MAIL_BASE}/api/attachments/archive?limit=5`).then((r) => r.json());
  const entries = arch.entries || arch.items || [];
  record(
    "Mail sample",
    "attachment archive",
    entries.length ? "PASS" : "PARTIAL",
    `entries=${entries.length}`,
  );

  const entry = entries[0];
  if (entry?.accountId && entry?.messageId && entry?.attachmentId) {
    const qs = new URLSearchParams({
      accountId: entry.accountId,
      messageId: entry.messageId,
      attachmentId: entry.attachmentId,
      name: entry.name || "attachment",
    });
    const dl = await fetch(
      `${MAIL_BASE}/api/attachments/archive/download-url?${qs}`,
    );
    const dlJson = await dl.json().catch(() => ({}));
    record(
      "Mail sample",
      "archive download-url",
      dl.ok && dlJson.url ? "PASS" : "FAIL",
      dlJson.url || dlJson.message || `HTTP ${dl.status}`,
    );
  }

  return { accountId, attachments, archiveEntries: entries };
}

async function ingestPortalMail() {
  const connect = await http("POST", `${PORTAL_BASE}/api/portal`, {
    action: "connect-outlook",
    projectSlug: "demo-project",
  });
  if (!connect.ok || !connect.json?.account?.id) {
    record("Portal mail", "connect-outlook", "FAIL", String(connect.status));
    return null;
  }
  const accountId = connect.json.account.id;
  record("Portal mail", "connect-outlook", "PASS", accountId);

  const sync = await http("POST", `${PORTAL_BASE}/api/portal`, {
    action: "sync-mail",
    accountId,
  });
  const count = sync.json?.messages?.length ?? 0;
  record(
    "Portal mail",
    "sync-mail (mock samples)",
    sync.ok && count >= 3 ? "PASS" : "FAIL",
    `messages=${count}`,
  );

  const portalGet = await fetch(`${PORTAL_BASE}/api/portal`).then((r) => r.json());
  record(
    "Portal mail",
    "GET /api/portal overview",
    portalGet.overview ? "PASS" : "FAIL",
    `tasks=${portalGet.tasks?.length ?? 0}`,
  );

  await checkRoute("Portal mail", "/portal");
  return accountId;
}

async function verifyBusinessModules() {
  const modules = [
    ["Dashboard", "/dashboard"],
    ["Customers", "/customers"],
    ["Partners", "/partners"],
    ["Tasks", "/tasks"],
    ["PoC", "/poc"],
    ["Opportunities", "/opportunities"],
    ["Proposals", "/proposals"],
    ["Knowledge", "/knowledge"],
    ["Commands", "/commands"],
    ["Development", "/development"],
    ["Validation", "/validation"],
    ["Modules", "/modules"],
    ["Registry", "/registry"],
  ];
  for (const [name, path] of modules) {
    await checkRoute(name, path);
  }

  const apis = [
    ["Customers API", "/api/customers"],
    ["Partners API", "/api/partners"],
    ["Tasks API", "/api/tasks"],
    ["PoC API", "/api/poc"],
    ["Opportunities API", "/api/opportunities"],
    ["Proposals API", "/api/proposals"],
    ["Knowledge API", "/api/knowledge"],
    ["Commands API", "/api/commands"],
  ];
  for (const [name, path] of apis) {
    const res = await fetch(`${PORTAL_BASE}${path}`);
    const json = await res.json().catch(() => ({}));
    const hasData =
      json.customers?.length ||
      json.partners?.length ||
      json.tasks?.length ||
      json.projects?.length ||
      json.opportunities?.length ||
      json.documents?.length ||
      json.runs?.length;
    record(name, path, res.ok ? "PASS" : "FAIL", hasData ? "has seed data" : "empty list");
  }
}

async function verifyPhase13WithMail() {
  const attList = mailSample.attachmentNames.length
    ? `; attachments=${mailSample.attachmentNames.join("|")}`
    : "";
  const inputSummary = [
    "AIOS feature verification pilot",
    `subject=${mailSample.subject}`,
    `from=${mailSample.from}`,
    mailSample.bodyPreview ? `preview=${mailSample.bodyPreview.slice(0, 120)}` : "",
    attList,
  ]
    .filter(Boolean)
    .join("; ");

  const body = {
    inputSummary,
    projectSlug: "demo-project",
    module: "mail-intelligence",
    phase: 13,
  };
  const res = await http("POST", `${PORTAL_BASE}/api/automation/phase13/run`, body);
  const items = res.json?.workBreakdownItems?.length ?? 0;
  const hasHandoff = Boolean(res.json?.handoffDraft?.validationCommands?.length);
  record(
    "Phase13 orchestrator",
    "POST /api/automation/phase13/run (mail input)",
    res.status === 201 && items > 0 ? "PASS" : "FAIL",
    `HTTP ${res.status}; items=${items}; handoff=${hasHandoff}`,
  );

  const opp = await fetch(`${PORTAL_BASE}/api/opportunities`).then((r) => r.json());
  const oppId = opp.opportunities?.[0]?.id;
  if (oppId) {
    const oppRes = await http("POST", `${PORTAL_BASE}/api/automation/phase13/run`, {
      inputSummary: `Opportunity follow-up tied to mail: ${mailSample.subject}`,
      phase: 13,
      sourceEntityType: "opportunity",
      sourceEntityId: oppId,
    });
    record(
      "Phase13 orchestrator",
      "bound to opportunity",
      oppRes.status === 201 ? "PASS" : "FAIL",
      `HTTP ${oppRes.status}`,
    );
  }
}

async function verifyModulesAndGuardrails() {
  const mods = await fetch(`${PORTAL_BASE}/api/modules`).then((r) => r.json());
  const key = mods.modules?.[0]?.moduleKey;
  if (key) {
    const v = await http("POST", `${PORTAL_BASE}/api/modules/${key}/validate`, {});
    record(
      "Modules runtime",
      `validate ${key}`,
      typeof v.json?.valid === "boolean" ? "PASS" : "FAIL",
      `HTTP ${v.status}`,
    );
  }

  const forbidden = await http("POST", `${PORTAL_BASE}/api/actions/mail.send/validate`, {});
  record(
    "Modules runtime",
    "mail.send forbidden",
    forbidden.status === 400 ? "PASS" : "FAIL",
    `HTTP ${forbidden.status}`,
  );
}

async function verifyImprovements() {
  const create = await http("POST", `${PORTAL_BASE}/api/improvements`, {
    message: `Mail-assisted verification: ${mailSample.subject}`,
    sourceType: "mail_verification",
  });
  const id = create.json?.candidate?.id;
  record(
    "Improvements",
    "create candidate",
    create.ok && id ? "PASS" : "FAIL",
    id || "",
  );
  if (id) {
    const patch = await http("PATCH", `${PORTAL_BASE}/api/improvements/${id}`, {
      status: "approved",
    });
    record("Improvements", "approve", patch.ok ? "PASS" : "FAIL", `HTTP ${patch.status}`);
    const run = await http("POST", `${PORTAL_BASE}/api/improvements/${id}/run-phase13`, undefined);
    record("Improvements", "run-phase13", run.status < 500 ? "PASS" : "FAIL", `HTTP ${run.status}`);
  }
}

function renderReport() {
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const partial = results.filter((r) => r.status === "PARTIAL").length;
  const verdict = fail === 0 ? "**PASS**" : "**FAIL**";

  const lines = [
    "# AIOS Feature Verification (Mail + Attachments)",
    "",
    `Date: 2026-06-01 KST`,
    `Portal: ${PORTAL_BASE}`,
    `Mail app: ${MAIL_BASE}`,
    "",
    "## Verification plan",
    "",
    "1. **Sample data** — Live mail + attachment metadata from standalone Mail Intelligence (`:3010`).",
    "2. **AIOS ingest** — `POST /api/portal` connect-outlook + sync-mail (mock DB rows + task links).",
    "3. **Feature matrix** — Portal pages, REST APIs, Phase13 orchestrator (mail-enriched input), modules guardrails, improvements loop.",
    "4. **Attachment path** — Standalone archive + download-url + per-message attachments (portal has no attachment DB model).",
    "",
    "## Mail sample used",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Subject | ${mailSample.subject.replace(/\|/g, "\\|")} |`,
    `| From | ${mailSample.from} |`,
    `| Attachments | ${mailSample.attachmentNames.join(", ") || "(none)"} |`,
    "",
    "## Results summary",
    "",
    `| Metric | Count |`,
    `| --- | ---: |`,
    `| PASS | ${pass} |`,
    `| PARTIAL | ${partial} |`,
    `| FAIL | ${fail} |`,
    "",
    `**Verdict:** ${verdict}`,
    "",
    "## Detailed matrix",
    "",
    "| Feature | Step | Status | Detail |",
    "| --- | --- | --- | --- |",
  ];
  for (const r of results) {
    lines.push(
      `| ${r.feature} | ${r.step} | ${r.status} | ${String(r.detail).replace(/\|/g, "\\|").slice(0, 80)} |`,
    );
  }
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  console.log(`\nReport written: ${REPORT_PATH}`);
  console.log(`Summary: PASS=${pass} PARTIAL=${partial} FAIL=${fail} => ${verdict}`);
  return fail === 0 ? 0 : 1;
}

async function main() {
  console.log("=== AIOS feature verification (mail + attachments) ===\n");
  const health = await fetch(`${PORTAL_BASE}/api/health`).then((r) => r.json());
  record("Infrastructure", "AIOS /api/health", health.status === "ok" ? "PASS" : "FAIL");

  await collectMailSample();
  await ingestPortalMail();
  await verifyBusinessModules();
  await verifyPhase13WithMail();
  await verifyModulesAndGuardrails();
  await verifyImprovements();

  process.exit(renderReport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
