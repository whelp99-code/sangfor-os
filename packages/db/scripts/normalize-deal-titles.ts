import { PrismaClient } from "@prisma/client";

import {
  mailCandidateNextAction,
  normalizeDealTitle,
  withTag,
} from "../../business/src/crm/deal-title";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const LEGACY_NEXT_ACTION = /^Review approved mail candidate:\s*/i;

// 접두어 없이 메일 요약이 통째로 들어간 과거 행: 줄바꿈이나 [받은]/[보낸] 머리표로 알아본다.
const RAW_MAIL_DUMP = /\n|\[받은\]|\[보낸\]/;

// 앞선 백필이 이미 붙여둔 한국어 접두어. 다시 정규화할 때 이중으로 붙지 않게 먼저 벗긴다.
const APPLIED_PREFIX = /^승인된 메일 후보 검토(\s*—\s*)?/;

function cleanNextAction(value: string | null): string | null {
  if (!value) return value;
  const stripped = value.replace(LEGACY_NEXT_ACTION, "").replace(APPLIED_PREFIX, "");
  if (LEGACY_NEXT_ACTION.test(value) || RAW_MAIL_DUMP.test(value)) {
    return mailCandidateNextAction(stripped);
  }
  return value;
}

async function main() {
  const deals = await prisma.opportunity.findMany({
    select: { id: true, title: true, nextAction: true },
  });

  const changes = deals
    .map((d) => ({
      id: d.id,
      before: d.title,
      after: withTag(normalizeDealTitle(d.title)),
      nextBefore: d.nextAction,
      nextAfter: cleanNextAction(d.nextAction),
    }))
    .filter((c) => c.after !== c.before || c.nextAfter !== c.nextBefore);

  for (const c of changes) {
    if (c.after !== c.before) console.log(`title  - ${c.before}\n       + ${c.after}`);
    if (c.nextAfter !== c.nextBefore) console.log(`next   - ${c.nextBefore}\n       + ${c.nextAfter}`);
    console.log("");
  }
  console.log(`${changes.length} / ${deals.length} 건 변경 대상`);

  if (!APPLY) {
    console.log("\ndry-run입니다. 적용하려면 --apply를 붙이세요.");
    return;
  }

  await prisma.$transaction(
    changes.map((c) =>
      prisma.opportunity.update({
        where: { id: c.id },
        data: { title: c.after, nextAction: c.nextAfter },
      }),
    ),
  );
  console.log(`\n${changes.length}건 적용 완료.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
