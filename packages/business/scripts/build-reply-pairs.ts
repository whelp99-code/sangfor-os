/**
 * 프로즈 쌍 생성: 받은 메일 → 내가 실제로 쓴 답장.
 *
 * "어떻게 해결하는가"의 정답지. 파인튜닝·few-shot 프롬프트의 재료이자, AI가 초안을
 * 쓸 때 문체·구조·위임 습관을 흉내 낼 근거다. 같은 대화 안에서 내 outbound 직전의
 * inbound를 짝지어 만든다.
 *
 * Usage: tsx packages/business/scripts/build-reply-pairs.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@sangfor/db";

import { maskPii } from "../src/mail/outlook/mail-pii";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(REPO_ROOT, ".agents/results/learning/reply-pairs.json");

// 답장이 이보다 짧으면 "감사합니다" 수준이라 문체 신호가 없다.
const MIN_REPLY = 30;

async function main() {
  const messages = await prisma.mailMessage.findMany({
    where: { conversationId: { not: null }, body: { not: null } },
    select: {
      conversationId: true,
      subject: true,
      fromEmail: true,
      direction: true,
      receivedAt: true,
      body: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const byConversation = new Map<string, typeof messages>();
  for (const m of messages) {
    const key = m.conversationId!;
    if (!byConversation.has(key)) byConversation.set(key, []);
    byConversation.get(key)!.push(m);
  }

  const pairs: Array<Record<string, unknown>> = [];

  for (const thread of byConversation.values()) {
    for (const [i, m] of thread.entries()) {
      if (m.direction !== "outbound") continue;
      const reply = maskPii((m.body ?? "").trim());
      if (reply.length < MIN_REPLY) continue;

      // 내 답장 직전의 inbound가 이 답장이 응답한 대상이다.
      const prompt = thread
        .slice(0, i)
        .reverse()
        .find((p) => p.direction === "inbound" && (p.body ?? "").trim().length >= MIN_REPLY);
      if (!prompt) continue;

      pairs.push({
        subject: m.subject,
        from: prompt.fromEmail,
        domain: prompt.fromEmail.split("@")[1],
        receivedAt: m.receivedAt?.toISOString().slice(0, 10),
        incoming: maskPii((prompt.body ?? "").slice(0, 2_000)),
        myReply: reply.slice(0, 2_000),
      });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(pairs, null, 2), "utf8");

  const lens = pairs.map((p) => String(p.myReply).length).sort((a, b) => a - b);
  console.log(`프로즈 쌍 ${pairs.length}건 → ${OUT}`);
  console.log(`  내 답장 길이 중앙값 ${lens[Math.floor(lens.length / 2)] ?? 0}자 / 최대 ${lens.at(-1) ?? 0}자`);

  const byDomain = new Map<string, number>();
  for (const p of pairs) byDomain.set(String(p.domain), (byDomain.get(String(p.domain)) ?? 0) + 1);
  console.log("\n상대 도메인 top5:");
  for (const [d, n] of [...byDomain].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  ${d}: ${n}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
