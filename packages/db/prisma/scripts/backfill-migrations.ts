import { prisma } from "../../src/index";

async function backfillCustomer() {
  const updated = await prisma.customer.updateMany({
    where: { OR: [{ segment: null }, { riskScore: null }] },
    data: { segment: "UNCLASSIFIED", riskScore: 0.5 },
  });
  console.log(`customer: ${updated.count} rows backfilled (segment/riskScore)`);
}

async function backfillOpportunityStageEnteredAt() {
  // stageEnteredAt: 현재 stage로 전환된 최신 stage event의 createdAt, 없으면 opportunity.createdAt
  const opportunities = await prisma.opportunity.findMany({
    where: { stageEnteredAt: null },
    select: { id: true, stage: true, createdAt: true },
  });
  let fromEvent = 0;
  let fromCreatedAt = 0;
  for (const opp of opportunities) {
    const lastEvent = await prisma.opportunityStageEvent.findFirst({
      where: { opportunityId: opp.id, toStage: opp.stage },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { stageEnteredAt: lastEvent?.createdAt ?? opp.createdAt },
    });
    if (lastEvent) fromEvent += 1;
    else fromCreatedAt += 1;
  }
  console.log(
    `opportunity: ${opportunities.length} rows backfilled (stageEnteredAt; ${fromEvent} from stage events, ${fromCreatedAt} from createdAt)`,
  );
}

async function main() {
  await backfillCustomer();
  await backfillOpportunityStageEnteredAt();
  console.log("backfill complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
