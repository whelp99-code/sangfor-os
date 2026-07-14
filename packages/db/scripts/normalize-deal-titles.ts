import { PrismaClient } from "@prisma/client";

import {
  mailCandidateNextAction,
  normalizeDealTitle,
  withTag,
} from "../../business/src/crm/deal-title";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const LEGACY_NEXT_ACTION = /^Review approved mail candidate:\s*/i;

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
      nextAfter: d.nextAction?.match(LEGACY_NEXT_ACTION)
        ? mailCandidateNextAction(d.nextAction.replace(LEGACY_NEXT_ACTION, ""))
        : d.nextAction,
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
