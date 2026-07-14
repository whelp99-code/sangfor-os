/**
 * 적체된 메일 후보를 학습된 엔티티 정책으로 재판정한다.
 *
 * 후보 697건은 학습 이전 정책으로 분류됐다. 그대로 승인하면 파트너/SI가 고객으로,
 * 구매포탈·뉴스레터 같은 시스템 발신이 회사로 등록된다.
 *
 * 판정 기준은 발신 도메인이 아니라 **후보가 만들려는 엔티티 이름**이다. 파트너가
 * 최종고객 건을 물어오는 것은 정상이므로(JNG → 인카금융), 발신만 보면 오판한다.
 *
 * Usage: tsx packages/business/scripts/reclassify-candidates.ts [--apply]
 */
import { prisma } from "@sangfor/db";

import { buildMailPolicyLookup } from "../src/mail/mail-policy-memory";
import { isKnownPartner } from "../src/mail/classify-rules";

const APPLY = process.argv.includes("--apply");

// 업무 상대가 아닌 발신자. 구매 시스템 자동발신과 마케팅 뉴스레터라 엔티티가 될 수 없다.
const SYSTEM_SENDERS: Record<string, string> = {
  "snetgroup.co.kr": "구매포탈 자동발신 (eps-admin@)",
  "gowid.com": "마케팅 뉴스레터",
  "eformsign.com": "전자서명 시스템 발신",
};

// 정책 label이 후보 이름으로 새어 들어간 흔적. 내가 label에 설명문을 넣은 탓에
// 크론이 이런 이름의 후보를 만들었다.
const POLLUTED_NAME = /→\s*(파트너|고객|벤더)|메일 이력/;

const ENTITY_PREFIX = /^(Customer|Partner|Opportunity|PoC|Follow up):\s*/i;

function entityName(title: string): string {
  return title.replace(ENTITY_PREFIX, "").trim();
}

async function main() {
  const policy = await buildMailPolicyLookup();
  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "proposed" },
    select: { id: true, title: true, candidateType: true, sourceSender: true },
  });

  const toPartner: typeof candidates = [];
  const toReject: Array<{ c: (typeof candidates)[number]; reason: string }> = [];

  for (const c of candidates) {
    const name = entityName(c.title);

    if (POLLUTED_NAME.test(name)) {
      toReject.push({ c, reason: "policy_label_leak" });
      continue;
    }
    const systemReason = SYSTEM_SENDERS[c.sourceSender ?? ""];
    if (systemReason && (c.candidateType === "customer" || c.candidateType === "partner")) {
      toReject.push({ c, reason: "system_sender" });
      continue;
    }
    // 파트너 회사를 고객으로 만들려는 후보만 뒤집는다. 파트너가 물어온 최종고객
    // 후보(JNG 발신 + 인카금융서비스)는 이름이 파트너가 아니므로 그대로 둔다.
    if (c.candidateType === "customer" && isKnownPartner(name, policy)) {
      toPartner.push(c);
    }
  }

  console.log(`적체 후보 ${candidates.length}건 검토${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);
  console.log(`고객 → 파트너 전환: ${toPartner.length}건`);
  for (const c of toPartner.slice(0, 8)) console.log(`   ${entityName(c.title)}  (${c.sourceSender})`);
  console.log(`\n반려: ${toReject.length}건`);
  const byReason = new Map<string, number>();
  for (const r of toReject) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`   ${reason}: ${n}`);

  if (!APPLY) return;

  let converted = 0;
  let duplicate = 0;
  for (const c of toPartner) {
    try {
      await prisma.mailDerivedCandidate.update({
        where: { id: c.id },
        data: {
          candidateType: "partner",
          title: c.title.replace(ENTITY_PREFIX, "Partner: "),
        },
      });
      converted++;
    } catch (e) {
      // (knowledge_document_id, candidate_type) 유니크 — 같은 메일에 이미 partner 후보가
      // 있다는 뜻이다. 전환하면 중복이 되므로 이 customer 후보는 반려한다.
      if ((e as { code?: string }).code !== "P2002") throw e;
      await prisma.mailDerivedCandidate.update({
        where: { id: c.id },
        data: { status: "rejected" },
      });
      duplicate++;
    }
  }
  for (const { c, reason } of toReject) {
    await prisma.mailDerivedCandidate.update({
      where: { id: c.id },
      data: { status: "rejected" },
    });
    void reason;
  }

  console.log(`\n반영 완료 — 전환 ${converted} · 중복반려 ${duplicate} · 반려 ${toReject.length}`);
  const left = await prisma.mailDerivedCandidate.count({ where: { status: "proposed" } });
  console.log(`남은 proposed: ${left}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
