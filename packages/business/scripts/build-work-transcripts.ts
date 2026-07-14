/**
 * 대화 단위 업무 트랜스크립트 생성.
 *
 * 학습 대상은 "내가 답장한 대화" — 답장이 없는 대화는 수신함 소음이지 업무가 아니다.
 * 각 대화를 시간순 평문으로 묶어 파일로 떨어뜨린다. 여기서부터 페르소나별 분석이 읽는다.
 *
 * Usage: tsx packages/business/scripts/build-work-transcripts.ts [--min-messages N]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@sangfor/db";

import { maskPii } from "../src/mail/outlook/mail-pii";

// cwd는 실행 워크스페이스(packages/db 등)라 믿을 수 없다. 파일 위치에서 리포 루트를 잡는다.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = path.join(REPO_ROOT, ".agents/results/learning/transcripts");
const minArg = process.argv.indexOf("--min-messages");
const MIN_MESSAGES = minArg > -1 ? Number(process.argv[minArg + 1]) : 2;

// 본문이 이보다 짧으면 자동알림·수신확인이라 업무 신호가 없다.
const MIN_BODY = 40;

async function main() {
  const messages = await prisma.mailMessage.findMany({
    where: { conversationId: { not: null } },
    select: {
      conversationId: true,
      subject: true,
      fromEmail: true,
      toEmail: true,
      direction: true,
      receivedAt: true,
      body: true,
      bodyPreview: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const byConversation = new Map<string, typeof messages>();
  for (const m of messages) {
    const key = m.conversationId!;
    if (!byConversation.has(key)) byConversation.set(key, []);
    byConversation.get(key)!.push(m);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) fs.unlinkSync(path.join(OUT_DIR, f));

  const index: Array<Record<string, unknown>> = [];
  let written = 0;

  for (const [conversationId, thread] of byConversation) {
    const replied = thread.some((m) => m.direction === "outbound");
    if (!replied || thread.length < MIN_MESSAGES) continue;

    const lines: string[] = [];
    for (const m of thread) {
      const text = maskPii((m.body ?? m.bodyPreview ?? "").trim());
      if (text.length < MIN_BODY && m.direction === "inbound") continue;
      const who = m.direction === "outbound" ? "나(blro)" : m.fromEmail;
      const when = m.receivedAt?.toISOString().slice(0, 10) ?? "?";
      lines.push(`### [${when}] ${who} → ${m.toEmail ?? "?"}\n제목: ${m.subject}\n\n${text}`);
    }
    if (lines.length < MIN_MESSAGES) continue;

    const domains = [
      ...new Set(
        thread
          .filter((m) => m.direction === "inbound")
          .map((m) => m.fromEmail.split("@")[1])
          .filter(Boolean),
      ),
    ];
    const first = thread[0];
    const last = thread.at(-1)!;

    const file = `${String(written).padStart(3, "0")}-${conversationId.slice(-8)}.md`;
    fs.writeFileSync(
      path.join(OUT_DIR, file),
      `# ${first.subject}\n\n` +
        `- 대화 ID: ${conversationId}\n` +
        `- 기간: ${first.receivedAt?.toISOString().slice(0, 10)} ~ ${last.receivedAt?.toISOString().slice(0, 10)}\n` +
        `- 메일 ${thread.length}건 (내 답장 ${thread.filter((m) => m.direction === "outbound").length}건)\n` +
        `- 상대 도메인: ${domains.join(", ")}\n\n---\n\n` +
        lines.join("\n\n---\n\n"),
      "utf8",
    );

    index.push({
      file,
      conversationId,
      subject: first.subject,
      messages: thread.length,
      myReplies: thread.filter((m) => m.direction === "outbound").length,
      domains,
      start: first.receivedAt?.toISOString().slice(0, 10),
      end: last.receivedAt?.toISOString().slice(0, 10),
    });
    written++;
  }

  fs.writeFileSync(path.join(OUT_DIR, "..", "index.json"), JSON.stringify(index, null, 2), "utf8");
  console.log(`업무 트랜스크립트 ${written}건 생성 → ${OUT_DIR}`);
  console.log(`  (전체 대화 ${byConversation.size} 중 내가 답장하고 ${MIN_MESSAGES}건 이상인 것만)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
