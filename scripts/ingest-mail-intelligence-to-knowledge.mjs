#!/usr/bin/env node
/**
 * Ingest Mail Intelligence AI thread insights into AIOS knowledge, then generate AIOS candidates.
 *
 * Primary source:
 *   GET ${MAIL_INTELLIGENCE_BASE_URL}/api/outlook/analyze?cacheOnly=1&full=1&top=50
 *
 * Fallback:
 *   Raw accounts.json ingest is disabled unless MAIL_INGEST_RAW_FALLBACK=1.
 *
 * Usage:
 *   node scripts/ingest-mail-intelligence-to-knowledge.mjs
 *   MAIL_INGEST_LIMIT=50 node scripts/ingest-mail-intelligence-to-knowledge.mjs
 *   MAIL_INTELLIGENCE_BASE_URL=http://localhost:3010 node scripts/ingest-mail-intelligence-to-knowledge.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIL_INTELLIGENCE_ROOT =
  process.env.MAIL_INTELLIGENCE_ROOT || join(ROOT, "..", "apps", "mail-intelligence");
const DEFAULT_ACCOUNTS_PATH =
  process.env.MAIL_ACCOUNTS_PATH || join(MAIL_INTELLIGENCE_ROOT, "data", "accounts.json");
const DEFAULT_SQLITE_PATH =
  process.env.MAIL_SQLITE_PATH || join(MAIL_INTELLIGENCE_ROOT, "data.db");
const PORTAL_BASE = process.env.BASE_URL || "http://localhost:3101";
const MAIL_INTELLIGENCE_BASE =
  process.env.MAIL_INTELLIGENCE_BASE_URL ||
  process.env.MAIL_OAUTH_BASE_URL ||
  "http://localhost:3010";
const PROJECT_SLUG = process.env.KNOWLEDGE_PROJECT_SLUG || "demo-project";
const CONCURRENCY = Math.max(1, Number(process.env.MAIL_INGEST_CONCURRENCY || 8));
const INGEST_LIMIT = Math.max(1, Number(process.env.MAIL_INGEST_LIMIT || 50));
const RAW_FALLBACK = process.env.MAIL_INGEST_RAW_FALLBACK === "1";
const GENERATE_CANDIDATES = process.env.MAIL_GENERATE_CANDIDATES_AFTER_INGEST !== "0";
const DRY_RUN = process.env.DRY_RUN === "1";

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value, max = 700) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function extractDomain(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match?.[1]?.toLowerCase();
}

function messageBody(message) {
  const plain = String(message.body || "").trim();
  if (plain.length > 40) return plain;
  const fromHtml = stripHtml(message.bodyHtml);
  if (fromHtml.length > 40) return fromHtml;
  const preview = String(message.bodyPreview || "").trim();
  if (preview) return preview;
  return plain || fromHtml || preview || "(empty body)";
}

function buildRawDocument(message) {
  const subject = String(message.subject || "(no subject)").trim();
  const from = String(message.fromName || message.from || "unknown").trim();
  const receivedAt = message.receivedAt ? new Date(message.receivedAt).toISOString() : "";
  const attachments = Array.isArray(message.attachmentNames)
    ? message.attachmentNames.filter(Boolean)
    : [];
  const body = messageBody(message);
  const header = [
    `From: ${from}`,
    message.from ? `Email: ${message.from}` : "",
    receivedAt ? `Received: ${receivedAt}` : "",
    message.mailFolder ? `Folder: ${message.mailFolder}` : "",
    attachments.length ? `Attachments: ${attachments.join(", ")}` : "",
    `MessageId: ${message.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  const isVendor = isVendorSupportMessage(message);
  const tags = unique([
    "mail-intelligence",
    `mail-id:${message.id}`,
    ...(isVendor ? ["vendor-support", "sangfor-tech-support"] : []),
    ...asArray(message.revenueOpsTags),
  ]);

  const prefix = isVendor ? "[Vendor Support] " : "";

  return {
    projectSlug: PROJECT_SLUG,
    title: `${prefix}Mail: ${subject}`.slice(0, 200),
    body: `${header}\n\n${body}`.slice(0, 50_000),
    tags: tags.slice(0, 20),
    source: isVendor ? "vendor-support" : "mail-intelligence",
  };
}

async function httpJson(method, url, body) {
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

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function loadMessagesFromAccountsJson(accountsPath) {
  const store = JSON.parse(readFileSync(accountsPath, "utf8"));
  const messages = [];
  for (const account of store.accounts || []) {
    for (const message of account.messages || []) {
      if (!message || message.isDeleted) continue;
      messages.push({ ...message, accountId: account.id, accountEmail: account.email });
    }
  }
  return messages;
}

function parseJsonObject(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeSqliteMessageRow(row) {
  const raw = parseJsonObject(row.raw_json);
  const from = row.from_addr || raw.from || raw.sender || "unknown";
  return {
    ...raw,
    id: String(row.id),
    subject: row.subject || raw.subject || "(no subject)",
    from,
    fromName: row.from_name || raw.fromName || raw.senderName || from,
    receivedAt: row.received_at || raw.receivedAt,
    bodyPreview: row.body_preview || raw.bodyPreview || raw.preview || "",
    body: raw.body || row.body_preview || "",
    accountId: raw.accountId || "mail-intel-sqlite",
    accountEmail: raw.accountEmail || from,
    revenueOpsTags: [row.category, row.urgency, row.sentiment].filter(Boolean),
    aiEnhanced: false,
    confidence: row.confidence ?? raw.confidence,
  };
}

export function selectRawFallbackSource({ accountsPath, sqlitePath, exists = existsSync }) {
  if (exists(accountsPath)) return "accounts-json";
  if (exists(sqlitePath)) return "sqlite";
  throw new Error(`no_supported_mail_cache_found:${accountsPath}:${sqlitePath}`);
}

function loadMessagesFromSqlite(sqlitePath) {
  const sql = `
    SELECT id, subject, from_addr, from_name, received_at, body_preview,
           category, urgency, sentiment, confidence, raw_json
    FROM messages
    ORDER BY datetime(received_at) DESC
    LIMIT ${INGEST_LIMIT};
  `;
  const output = execFileSync("sqlite3", ["-json", sqlitePath, sql], { encoding: "utf8" });
  const rows = JSON.parse(output || "[]");
  return rows.map(normalizeSqliteMessageRow);
}

function loadMessages(accountsPath = DEFAULT_ACCOUNTS_PATH, sqlitePath = DEFAULT_SQLITE_PATH) {
  const source = selectRawFallbackSource({ accountsPath, sqlitePath });
  const messages = source === "accounts-json"
    ? loadMessagesFromAccountsJson(accountsPath)
    : loadMessagesFromSqlite(sqlitePath);
  messages.sort(
    (a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime(),
  );
  return messages;
}

async function fetchMailIntelligenceAnalysis() {
  const url = new URL("/api/outlook/analyze", MAIL_INTELLIGENCE_BASE);
  url.searchParams.set("cacheOnly", "1");
  url.searchParams.set("quick", "1");
  url.searchParams.set("top", String(INGEST_LIMIT));
  return httpJson("GET", url.toString());
}

function normalizedSubjectStem(subject = "") {
  return String(subject || "")
    .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function senderDomain(from = "") {
  const email = String(from).match(/<([^>]+)>/)?.[1] || String(from).trim();
  return email.split("@")[1]?.toLowerCase() || "unknown";
}

function threadKeyFor(message, insight) {
  const accountId = message?.accountId || insight?.accountId || "";
  const conv = String(message?.conversationId || insight?.conversationId || "").trim();
  if (conv && !conv.startsWith("demo-")) {
    return `conv:${accountId}:${conv}`;
  }
  const gk = String(message?.aiGroupKey || insight?.aiGroupKey || "").trim();
  if (gk) return `grp:${gk}`;
  
  const subject = message?.subject || insight?.subject || "";
  const from = message?.from || insight?.from || "";
  const sender = message?.fromName || message?.from || insight?.fromName || insight?.from || "unknown";
  const isPromotional = message?.isPromotional || insight?.isPromotional || false;
  
  const subj = normalizedSubjectStem(subject);
  const dom = senderDomain(from);
  const prefix = isPromotional ? "promo" : "mail";
  return `fb:${prefix}:${accountId}:${dom}:${sender}:${subj}`;
}

function isVendorSupportMessage(message) {
  if (!message) return false;
  const checkEmail = (emailStr) => {
    return String(emailStr ?? "").toLowerCase().includes("tech.support@sangfor.com");
  };
  
  const fromStr = String(message.from ?? message.fromName ?? "");
  if (checkEmail(fromStr)) return true;
  
  const recipients = [
    ...asArray(message.to),
    ...asArray(message.cc),
    ...asArray(message.bcc)
  ];
  for (const rec of recipients) {
    const addr = String(typeof rec === "string" ? rec : rec.email ?? rec.address ?? "");
    if (checkEmail(addr)) return true;
  }
  return false;
}

function statusRank(status) {
  return { urgent: 5, active: 4, waiting: 3, done: 2, reference: 1 }[status] || 0;
}

function summaryLines(insight) {
  if (Array.isArray(insight?.summary)) return insight.summary.map((item) => compact(item, 300));
  if (insight?.summary) return [compact(insight.summary, 300)];
  return [];
}

function domainsForMessage(message) {
  const recipients = [
    ...asArray(message?.to),
    ...asArray(message?.cc),
    ...asArray(message?.bcc),
  ];
  return unique([
    extractDomain(message?.from),
    ...recipients.map((item) => extractDomain(typeof item === "string" ? item : item?.email || item?.address)),
  ]);
}

function buildThreadPayloads(analysis) {
  const messages = asArray(analysis?.messages).slice(0, INGEST_LIMIT);
  const result = analysis?.result || {};
  const insights = asArray(result.messageInsights);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const groups = new Map();

  for (const insight of insights) {
    const message = messageById.get(insight.id) || {};
    const key = threadKeyFor(message, insight);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { key, messages: [], insights: [], nextActions: [] });
    }
    const group = groups.get(key);
    group.insights.push(insight);
    if (message.id) group.messages.push(message);
  }

  for (const action of asArray(result.nextActions)) {
    const message = messageById.get(action.messageId);
    const key = threadKeyFor(message, { id: action.messageId, conversationId: message?.conversationId });
    if (groups.has(key)) groups.get(key).nextActions.push(action);
  }

  return [...groups.values()].map((group) => {
    group.messages.sort(
      (a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime(),
    );
    const firstMessage = group.messages[0] || {};
    const firstInsight = group.insights[0] || {};
    const messageIds = unique([
      ...group.messages.map((message) => message.id),
      ...group.insights.map((insight) => insight.id),
    ]);
    const latestReceivedAt =
      group.messages.map((message) => message.receivedAt).filter(Boolean).sort().at(-1) ||
      firstInsight.receivedAt;
    const statuses = group.insights.map((insight) => insight.status || "reference");
    const status = statuses.sort((a, b) => statusRank(b) - statusRank(a))[0] || "reference";
    const evidenceItems = unique([
      ...group.insights.flatMap((insight) => asArray(insight.evidenceItems)),
      ...group.nextActions.map((action) => action.evidence),
    ]).slice(0, 12);
    const nextActions = [
      ...group.nextActions,
      ...group.insights.flatMap((insight) => asArray(insight.nextActions)),
    ].slice(0, 12);
    const summaries = group.insights.flatMap(summaryLines);
    const summary =
      summaries.length > 0
        ? summaries.slice(0, 8).join("\n")
        : compact(firstMessage.bodyPreview || firstMessage.body || firstMessage.subject || "No summary.");
    const isVendor = group.messages.some(isVendorSupportMessage) ||
                     group.insights.some(isVendorSupportMessage);
    const revenueOpsTags = unique([
      ...group.messages.flatMap((message) => asArray(message.revenueOpsTags)),
      ...(isVendor ? ["vendor-support", "sangfor-tech-support"] : [])
    ]);
    const participantDomains = unique(group.messages.flatMap(domainsForMessage));
    const aiEnhanced = group.insights.some((insight) => insight.aiEnhanced) || result.ai?.enabled === true;
    const prefix = isVendor ? "[Vendor Support] " : "";

    return {
      threadKey: String(group.key),
      threadTitle: `${prefix}${String(firstMessage.aiGroupTitle || firstMessage.subject || firstInsight.subject || "Mail thread")}`,
      sourceProvider: "mail-intelligence",
      accountId: firstMessage.accountId,
      accountEmail: firstMessage.accountEmail,
      messageCount: messageIds.length,
      messageIds,
      latestReceivedAt,
      status,
      effectiveStatus: status,
      aiEnhanced,
      summary,
      nextActions,
      evidenceItems,
      revenueOpsTags,
      participantDomains,
      metadata: {
        analyzedAt: analysis?.analyzedAt,
        ai: result.ai || null,
        sync: analysis?.sync || null,
        groupingReport: analysis?.groupingReport || null,
        aiError: analysis?.aiError || null,
        messages: group.messages.slice(0, 25).map((message) => ({
          id: message.id,
          subject: message.subject,
          from: message.from,
          fromName: message.fromName,
          receivedAt: message.receivedAt,
          conversationId: message.conversationId,
          aiGroupKey: message.aiGroupKey,
          aiGroupTitle: message.aiGroupTitle,
          isPromotional: message.isPromotional,
          revenueOpsTags: message.revenueOpsTags,
        })),
        insights: group.insights.slice(0, 25).map((insight) => ({
          id: insight.id,
          subject: insight.subject,
          status: insight.status,
          aiEnhanced: insight.aiEnhanced,
          aiRationale: insight.aiRationale,
          summary: insight.summary,
          evidenceItems: insight.evidenceItems,
        })),
      },
    };
  });
}

async function ingestThreadInsights() {
  const analysis = await fetchMailIntelligenceAnalysis();
  if (!analysis.ok) {
    throw new Error(`mail_intelligence_http_${analysis.status}`);
  }
  const threads = buildThreadPayloads(analysis.json);
  console.log(`mail intelligence threads: ${threads.length}`);
  if (threads.length === 0) {
    throw new Error("mail_intelligence_returned_no_threads");
  }
  if (DRY_RUN) {
    console.log(JSON.stringify(threads.slice(0, 3), null, 2));
    return { upserted: 0, createdDocuments: 0, updatedDocuments: 0, dryRun: true };
  }

  const response = await httpJson("POST", `${PORTAL_BASE}/api/mail-insight-threads`, {
    projectSlug: PROJECT_SLUG,
    threads,
  });
  if (!response.ok) {
    throw new Error(response.json?.error || `portal_thread_ingest_http_${response.status}`);
  }
  return response.json;
}

export function buildCandidateRequestBody({ projectSlug, limit, legacyKnowledgeFallback }) {
  return { projectSlug, limit, legacyKnowledgeFallback };
}

async function generateCandidates(legacyKnowledgeFallback = false) {
  if (!GENERATE_CANDIDATES || DRY_RUN) return null;
  const response = await httpJson("POST", `${PORTAL_BASE}/api/mail-candidates`, buildCandidateRequestBody({
    projectSlug: PROJECT_SLUG,
    limit: INGEST_LIMIT,
    legacyKnowledgeFallback,
  }));
  if (!response.ok) {
    throw new Error(response.json?.error || `candidate_generation_http_${response.status}`);
  }
  return response.json;
}

async function ingestRawFallback() {
  let messages;
  try {
    messages = loadMessages(DEFAULT_ACCOUNTS_PATH);
  } catch (error) {
    throw new Error(`could_not_read_accounts_store:${error instanceof Error ? error.message : error}`);
  }
  console.log(`cached messages: ${messages.length}`);

  const existing = await httpJson("GET", `${PORTAL_BASE}/api/knowledge`);
  const ingestedIds = new Set();
  for (const doc of existing.json?.documents || []) {
    for (const tag of doc.tags || []) {
      if (tag.startsWith("mail-id:")) ingestedIds.add(tag.slice("mail-id:".length));
    }
  }
  console.log(`already ingested (mail-id tag): ${ingestedIds.size}`);

  const pending = messages.filter((message) => !ingestedIds.has(message.id)).slice(0, INGEST_LIMIT);
  console.log(`raw fallback to ingest: ${pending.length}`);
  if (pending.length === 0 || DRY_RUN) {
    return { created: 0, failed: 0, rawFallback: true };
  }

  const stats = { created: 0, failed: 0, errors: [] };
  await mapWithConcurrency(pending, CONCURRENCY, async (message, index) => {
    const payload = buildRawDocument(message);
    const res = await httpJson("POST", `${PORTAL_BASE}/api/knowledge`, payload);
    if (res.ok && res.json?.document?.id) {
      stats.created += 1;
      if ((index + 1) % 50 === 0 || index === pending.length - 1) {
        console.log(`progress: ${index + 1}/${pending.length} (created=${stats.created})`);
      }
      return;
    }
    stats.failed += 1;
    if (stats.errors.length < 10) {
      stats.errors.push({
        messageId: message.id,
        status: res.status,
        error: res.json?.error || "create_failed",
      });
    }
  });
  return { ...stats, rawFallback: true };
}

async function main() {
  console.log("=== Mail Intelligence AI → AIOS Knowledge/Candidates ingest ===");
  console.log(`portal: ${PORTAL_BASE}`);
  console.log(`mail intelligence: ${MAIL_INTELLIGENCE_BASE}`);
  console.log(`project: ${PROJECT_SLUG}`);
  console.log(`mail ingest limit: ${INGEST_LIMIT}`);
  console.log(`raw fallback: ${RAW_FALLBACK ? "enabled" : "disabled"}`);
  console.log(`generate candidates: ${GENERATE_CANDIDATES ? "enabled" : "disabled"}`);
  console.log(`concurrency: ${CONCURRENCY}${DRY_RUN ? " (DRY_RUN)" : ""}`);

  const health = await fetch(`${PORTAL_BASE}/api/knowledge`);
  if (!health.ok) {
    console.error(`FAIL: portal not reachable at ${PORTAL_BASE} (HTTP ${health.status})`);
    process.exit(1);
  }

  let threadResult;
  try {
    threadResult = await ingestThreadInsights();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!RAW_FALLBACK) {
      console.error(`FAIL: Mail Intelligence analysis ingest failed: ${message}`);
      console.error("Raw accounts.json fallback is disabled. Set MAIL_INGEST_RAW_FALLBACK=1 to use it.");
      process.exit(1);
    }
    console.warn(`WARN: Mail Intelligence analysis ingest failed: ${message}`);
    threadResult = await ingestRawFallback();
  }

  let candidateResult = null;
  if (threadResult && !threadResult.failed) {
    candidateResult = await generateCandidates(Boolean(threadResult.rawFallback));
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`thread upserted: ${threadResult?.upserted ?? 0}`);
  console.log(`knowledge created: ${threadResult?.createdDocuments ?? threadResult?.created ?? 0}`);
  console.log(`knowledge updated: ${threadResult?.updatedDocuments ?? 0}`);
  if (candidateResult) {
    console.log(`candidates created: ${candidateResult.created}`);
    console.log(`candidates skipped: ${candidateResult.skipped}`);
    console.log(`candidates scanned: ${candidateResult.scanned}`);
    console.log(`candidates suppressed: ${candidateResult.suppressed ?? 0}`);
  }
  if (threadResult?.failed > 0) {
    console.log(`failed: ${threadResult.failed}`);
    console.log("sample errors:", JSON.stringify(threadResult.errors, null, 2));
    process.exit(1);
  }
  console.log("PASS: mail intelligence AIOS workflow ingest complete");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
