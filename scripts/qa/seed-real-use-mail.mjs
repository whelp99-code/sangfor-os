import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER_UNIT = "U076";

function fail(message) {
  throw Object.assign(new Error(`seed-real-use-mail: ${message}`), { exitCode: 64 });
}

function isTaskPostgresReceipt(value) {
  if (!value || typeof value !== "object") return false;
  const receipt = value;
  const sentinel = receipt.sentinel;
  return receipt.schemaVersion === 1
    && typeof receipt.runId === "string"
    && typeof receipt.ownerUnit === "string"
    && typeof receipt.purpose === "string"
    && typeof receipt.host === "string"
    && Number.isInteger(receipt.port)
    && typeof receipt.databaseName === "string"
    && typeof receipt.imageDigest === "string"
    && typeof receipt.migrate === "boolean"
    && typeof receipt.cleanupState === "string"
    && Boolean(sentinel)
    && sentinel?.schemaVersion === 1
    && typeof sentinel.runId === "string"
    && typeof sentinel.ownerUnit === "string"
    && typeof sentinel.purpose === "string"
    && typeof sentinel.imageDigest === "string";
}

export function assertTaskOwnedSeedEnvironment(env = process.env) {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    fail("production environment is forbidden");
  }

  const databaseUrlValue = env.DATABASE_URL?.trim();
  if (!databaseUrlValue) fail("DATABASE_URL is required");
  const taskOwnedDatabaseUrl = env.TASK_OWNED_DATABASE_URL?.trim();
  if (!taskOwnedDatabaseUrl) fail("TASK_OWNED_DATABASE_URL is required");
  if (databaseUrlValue !== taskOwnedDatabaseUrl) {
    fail("DATABASE_URL must exactly match TASK_OWNED_DATABASE_URL");
  }

  if (env.TASK_OWNER_UNIT?.trim() !== OWNER_UNIT) {
    fail(`TASK_OWNER_UNIT must be ${OWNER_UNIT}`);
  }
  const taskRunId = env.TASK_RUN_ID?.trim();
  if (!taskRunId) fail("TASK_RUN_ID is required");

  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlValue);
  } catch {
    return fail("DATABASE_URL is invalid");
  }
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    fail("DATABASE_URL must use PostgreSQL");
  }
  if (databaseUrl.hostname !== "127.0.0.1" && databaseUrl.hostname !== "localhost") {
    fail("DATABASE_URL must use a loopback host");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  if (!/^sangfor_task_[A-Za-z0-9_]+$/.test(databaseName)) {
    fail("DATABASE_URL database must match sangfor_task_*");
  }

  const receiptFileValue = env.TASK_POSTGRES_RECEIPT_FILE?.trim();
  if (!receiptFileValue) fail("TASK_POSTGRES_RECEIPT_FILE is required");
  const postgresReceiptFile = resolve(receiptFileValue);
  if (!existsSync(postgresReceiptFile)) fail("TASK_POSTGRES_RECEIPT_FILE does not exist");

  let receiptValue;
  try {
    receiptValue = JSON.parse(readFileSync(postgresReceiptFile, "utf8"));
  } catch {
    return fail("task PostgreSQL receipt is invalid JSON");
  }
  if (!isTaskPostgresReceipt(receiptValue)) fail("task PostgreSQL receipt has an invalid shape");
  const receipt = receiptValue;

  if (receipt.ownerUnit !== OWNER_UNIT || receipt.sentinel.ownerUnit !== OWNER_UNIT) {
    fail(`task PostgreSQL receipt owner must be ${OWNER_UNIT}`);
  }
  if (receipt.runId.length === 0 || receipt.sentinel.runId !== receipt.runId) {
    fail("task PostgreSQL receipt runId mismatch");
  }
  if (receipt.runId !== taskRunId) {
    fail("task PostgreSQL receipt does not match TASK_RUN_ID");
  }
  if (
    receipt.purpose !== receipt.sentinel.purpose
    || receipt.imageDigest !== receipt.sentinel.imageDigest
  ) {
    fail("task PostgreSQL receipt does not match its database sentinel");
  }
  const databasePort = Number(databaseUrl.port || "5432");
  if (
    receipt.host !== "127.0.0.1"
    || receipt.databaseName !== databaseName
    || receipt.port !== databasePort
  ) {
    fail("task PostgreSQL receipt does not match DATABASE_URL");
  }
  if (!receipt.migrate) fail("task PostgreSQL receipt must confirm migrations");
  if (receipt.cleanupState !== "open") fail("task PostgreSQL receipt is not open");

  return {
    ownerUnit: OWNER_UNIT,
    taskRunId,
    databaseName,
    databaseHost: databaseUrl.hostname,
    databasePort,
    postgresReceiptFile,
    postgresReceiptSha256: createHash("sha256")
      .update(readFileSync(postgresReceiptFile))
      .digest("hex"),
  };
}

const locations = [
  "서울", "부산", "인천", "대구", "대전", "광주", "울산", "수원", "창원", "고양",
];
const themes = [
  { key: "quantum", label: "양자보안", kind: "customer", phrase: "제품 도입을 위한 회사 정보 등록 요청" },
  { key: "channel", label: "채널유통", kind: "partner", phrase: "리셀러 파트너 계약 및 공동 영업 협업 제안" },
  { key: "license", label: "라이선스", kind: "opportunity", phrase: "라이선스 500석 구매 견적과 납기 요청" },
  { key: "poc", label: "PoC검증", kind: "poc", phrase: "보안 솔루션 PoC 테스트 일정과 검증 기준 요청" },
  { key: "followup", label: "후속조치", kind: "task", phrase: "기술 질의 회신과 다음 회의 일정 확인 요청" },
];

export async function seedRealUseMail(env = process.env, deps = {}) {
  assertTaskOwnedSeedEnvironment(env);

  const projectId = env.DEFAULT_PROJECT_ID?.trim();
  const output = env.REAL_USE_MAIL_MANIFEST?.trim();
  if (!projectId || !output) {
    fail("DEFAULT_PROJECT_ID and REAL_USE_MAIL_MANIFEST are required");
  }

  let disconnect = deps.disconnect ?? (async () => undefined);
  let createMailAccount = deps.createMailAccount;
  let createMailMessages = deps.createMailMessages;

  if (!createMailAccount || !createMailMessages) {
    const { prisma } = await import("@sangfor/db");
    createMailAccount = createMailAccount
      ?? ((data) => prisma.mailAccount.create({ data }));
    createMailMessages = createMailMessages
      ?? (async (data) => {
        await prisma.mailMessage.createMany({ data });
      });
    disconnect = deps.disconnect ?? (() => prisma.$disconnect());
  }

  try {
    const account = await createMailAccount({
      projectId,
      provider: "outlook",
      email: "real-use-100@sangfor.example.test",
      status: "connected",
      tenantId: "real-use-100-tenant",
      accessToken: "task-owned-synthetic-token",
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenScope: "Mail.Read User.Read",
    });

    const records = Array.from({ length: 50 }, (_, index) => {
      const sequence = index + 1;
      const location = locations[index % locations.length];
      const theme = themes[Math.floor(index / locations.length)];
      const company = `REALMAIL-${String(sequence).padStart(3, "0")} ${location} ${theme.label} 주식회사`;
      const domain = `realmail-${String(sequence).padStart(3, "0")}-${theme.key}.example.test`;
      const subject = `[${company}] ${theme.phrase}`;
      const fromEmail = `buyer${sequence}@${domain}`;
      return {
        sequence,
        channel: "email",
        kind: theme.kind,
        company,
        domain,
        subject,
        fromEmail,
        conversationId: `real-use-mail-conversation-${String(sequence).padStart(3, "0")}`,
      };
    });

    await createMailMessages(records.map((record) => ({
      accountId: account.id,
      subject: record.subject,
      fromEmail: record.fromEmail,
      toEmail: "real-use-100@sangfor.example.test",
      bodyPreview: `${record.company} 담당자입니다. ${record.subject}. 예산, 일정, 담당자를 포함해 회신 바랍니다.`,
      body: `${record.company}의 실제 운영 검증용 가상 메일입니다. ${record.subject}. 요청번호 ${record.sequence}.`,
      bodyFormat: "text",
      externalId: `real-use-mail-${String(record.sequence).padStart(3, "0")}`,
      conversationId: record.conversationId,
      direction: "inbound",
      receivedAt: new Date(Date.UTC(2026, 6, 27, 0, record.sequence, 0)),
    })));

    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    return { accountId: account.id, messages: records.length, output: resolve(output) };
  } finally {
    await disconnect();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entrypoint === import.meta.url) {
  seedRealUseMail().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    const code = typeof error === "object" && error && "exitCode" in error
      ? Number(error.exitCode)
      : 1;
    process.exit(Number.isInteger(code) && code > 0 ? code : 1);
  });
}
