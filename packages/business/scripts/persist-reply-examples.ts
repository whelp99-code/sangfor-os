/**
 * 프로즈 쌍(받은 메일 → 내가 쓴 답장)을 few-shot 예시로 영속화한다.
 *
 * AI가 대표 명의로 초안을 쓸 때 recall이 유사 상황의 실제 답장을 꺼내 그대로 본뜨게
 * 하는 것이 목적이다. DocumentVersion은 AI 생성 문서의 편집 이력용이라 자리가 아니고,
 * DomainMemory(case)에 `voice:` 태그로 넣어 업무 사례와 구분한다.
 *
 * Usage: tsx packages/business/scripts/persist-reply-examples.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "@sangfor/db";

import { upsertDomainMemory } from "../src/domain-ai/domain-memory";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PAIRS = path.join(REPO_ROOT, ".agents/results/learning/reply-pairs.json");
const APPLY = process.argv.includes("--apply");

interface Pair {
  subject: string;
  from: string;
  domain: string;
  receivedAt: string;
  incoming: string;
  myReply: string;
}

// 벤더는 영어로, 국내 상대는 한국어로 쓴다(영어 26건 중 22건이 sangfor.com). 도메인을
// 나눠 담아야 recall이 상대에 맞는 언어의 예시를 꺼낸다.
const VENDOR_DOMAINS = new Set(["sangfor.com", "aveva.com", "chinatelecomglobal.com"]);

function domainOf(pair: Pair): string {
  if (VENDOR_DOMAINS.has(pair.domain)) return "presales";
  return /견적|발주|계약|라이선스|리뉴얼/.test(pair.subject) ? "sales" : "presales";
}

async function main() {
  const pairs: Pair[] = JSON.parse(fs.readFileSync(PAIRS, "utf8"));
  console.log(`프로즈 쌍 ${pairs.length}건${APPLY ? "" : " (dry-run — --apply로 저장)"}`);

  let stored = 0;
  for (const [i, pair] of pairs.entries()) {
    const domain = domainOf(pair);
    stored++;
    if (!APPLY) continue;

    await upsertDomainMemory({
      domain,
      memoryType: "case",
      key: `reply-example:${String(i).padStart(3, "0")}`,
      label: `[답장 예시] ${pair.subject.slice(0, 120)}`,
      tags: [
        `domain:${domain}`,
        "voice:reply-example",
        `sender:${pair.domain}`,
        VENDOR_DOMAINS.has(pair.domain) ? "lang:en" : "lang:ko",
      ],
      valueJson: {
        source: "mail-history-reply-pairs",
        subject: pair.subject,
        from: pair.from,
        receivedAt: pair.receivedAt,
        incoming: pair.incoming,
        myReply: pair.myReply,
      },
      outcome: "approved",
      source: "human",
      confidence: 90,
    });
  }

  console.log(`\n답장 예시 ${stored}건`);
  if (APPLY) {
    const total = await prisma.domainMemory.count();
    const examples = await prisma.domainMemory.count({ where: { tags: { has: "voice:reply-example" } } });
    console.log(`저장 후 — DomainMemory ${total} (그중 답장 예시 ${examples})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
