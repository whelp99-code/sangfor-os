/**
 * 대표 확인 결과 반영 (2026-07-14, 데이터확인요청_20260714.xlsx).
 *
 * 메일만으로는 판정할 수 없던 55건에 대한 답이다. 여러 곳에서 내 판정이 틀렸다:
 *  - "고객"으로 본 GSITM·에스지나인·트러스타시큐리티·루키스가 전부 파트너였다.
 *  - "총판"은 하나가 아니라 제품별로 다르다 — Sangfor는 넥시아스·효성ITX,
 *    서버는 세연아이넷(케이투스)·HC코퍼레이션·오우션테크.
 *  - 세연아이넷은 케이투스 총판이지만 Sangfor 건에서는 파트너다.
 *  - 롯데카드는 고객이 아니다(카드 발급 안내 메일이 회사로 승격됐다).
 *
 * Usage: tsx packages/business/scripts/apply-owner-corrections.ts [--apply]
 */
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

const RENAME: Record<string, string> = {
  Kukjepharm: "국제약품",
  Sk: "코원에너지",
};

// 같은 회사가 두 행으로 갈라진 것. 딜을 정식 행으로 옮기고 중복 행을 지운다.
const MERGE_CUSTOMER: Record<string, string> = {
  IPG: "아이페이지온",
  "Az Tech": "아지텍",
};

// 회사가 아니거나 고객이 아닌 행.
const DELETE_CUSTOMER: Record<string, string> = {
  Lotte: "롯데카드 — 카드 발급 안내 메일이 회사로 승격됨. 고객 아님",
  Kwic: "출처 불명 — 대표 확인: 삭제",
  HIWARE: "솔루션 벤더 — 고객 아님",
  Hyosung: "효성ITX는 상포(Sangfor) 총판사 — 고객 아님",
};

// 고객으로 잘못 등록된 파트너. 딜의 고객은 실제 최종고객으로 바꾼다.
const CUSTOMER_TO_PARTNER: Array<{ name: string; endCustomer?: string; note: string }> = [
  { name: "GSITM", endCustomer: "GS건설", note: "GS건설 라이선스를 대신 구매·계약하는 구매대행 파트너" },
  { name: "에스지나인", note: "파트너" },
  { name: "트러스타시큐리티", note: "파트너 — 선진엔지니어링이 고객" },
  { name: "루키스", note: "파트너 — KB손해사정 녹취 솔루션 업체" },
];

// 없어서 만들어야 하는 회사.
const ADD_PARTNER = [
  { name: "효성ITX", note: "상포(Sangfor) 총판사" },
  { name: "하이퍼젠", note: "SK쉴더스 건 파트너" },
  { name: "루키스", note: "KB손해사정 녹취 솔루션 업체" },
];
const ADD_CUSTOMER = [{ name: "게임조선", note: "조선일보그룹 계열사" }];

// 직판은 거의 없고 Sangfor 총판은 모두 넥시아스다(대표 확인). 서버 건은 이미 서버
// 총판이 붙어 있으므로, 총판이 비어 있는 딜만 넥시아스로 채운다.
const DEFAULT_DISTRIBUTOR = "넥시아스";

async function main() {
  const log = (s: string) => console.log(s);
  log(`대표 확인 반영${APPLY ? "" : " (dry-run — --apply로 반영)"}\n`);

  const customerId = async (name: string) =>
    (await prisma.customer.findFirst({ where: { name }, select: { id: true } }))?.id;
  const partnerId = async (name: string) =>
    (await prisma.partner.findFirst({ where: { name }, select: { id: true } }))?.id;
  const projectId = (await prisma.project.findFirst({ select: { id: true } }))!.id;

  log("[1] 이름 정정");
  for (const [from, to] of Object.entries(RENAME)) {
    const id = await customerId(from);
    if (!id) continue;
    log(`    ${from} → ${to}`);
    if (APPLY) await prisma.customer.update({ where: { id }, data: { name: to } });
  }

  log("\n[2] 중복 병합");
  for (const [dup, canonical] of Object.entries(MERGE_CUSTOMER)) {
    const dupId = await customerId(dup);
    const canonicalId = await customerId(canonical);
    if (!dupId) continue;
    const deals = await prisma.opportunity.count({ where: { customerId: dupId } });
    log(`    ${dup} → ${canonical}${deals ? ` (딜 ${deals}건 이관)` : ""}`);
    if (!APPLY) continue;
    if (canonicalId) {
      await prisma.opportunity.updateMany({
        where: { customerId: dupId },
        data: { customerId: canonicalId },
      });
      await prisma.customer.delete({ where: { id: dupId } });
    } else {
      await prisma.customer.update({ where: { id: dupId }, data: { name: canonical } });
    }
  }

  log("\n[3] 고객 아님 — 삭제");
  for (const [name, reason] of Object.entries(DELETE_CUSTOMER)) {
    const id = await customerId(name);
    if (!id) continue;
    const deals = await prisma.opportunity.count({ where: { customerId: id } });
    log(`    ${name} — ${reason}${deals ? ` (딜 ${deals}건 고객 해제)` : ""}`);
    if (!APPLY) continue;
    if (deals) {
      await prisma.opportunity.updateMany({ where: { customerId: id }, data: { customerId: null } });
    }
    await prisma.customer.delete({ where: { id } });
  }

  log("\n[4] 신규 등록");
  for (const p of ADD_PARTNER) {
    if (await partnerId(p.name)) continue;
    log(`    파트너 ${p.name} — ${p.note}`);
    if (APPLY) {
      await prisma.partner.create({
        data: { projectId, name: p.name, partnerType: "mail-derived" },
      });
    }
  }
  for (const c of ADD_CUSTOMER) {
    if (await customerId(c.name)) continue;
    log(`    고객 ${c.name} — ${c.note}`);
    if (APPLY) await prisma.customer.create({ data: { projectId, name: c.name } });
  }

  log("\n[5] 고객 → 파트너 재분류 (딜의 고객은 실제 최종고객으로)");
  for (const item of CUSTOMER_TO_PARTNER) {
    const cid = await customerId(item.name);
    if (!cid) continue;
    const deals = await prisma.opportunity.count({ where: { customerId: cid } });
    const endId = item.endCustomer ? await customerId(item.endCustomer) : undefined;
    log(
      `    ${item.name} → 파트너 (${item.note})` +
        (deals ? ` · 딜 ${deals}건 → 고객=${item.endCustomer ?? "미지정"}` : ""),
    );
    if (!APPLY) continue;

    let pid = await partnerId(item.name);
    if (!pid) {
      pid = (
        await prisma.partner.create({
          data: { projectId, name: item.name, partnerType: "mail-derived" },
        })
      ).id;
    }
    if (deals) {
      await prisma.opportunity.updateMany({
        where: { customerId: cid },
        data: { customerId: endId ?? null, partnerId: pid },
      });
    }
    await prisma.customer.delete({ where: { id: cid } });
  }

  log("\n[6] 세연아이넷 — Sangfor 건에서는 파트너다(케이투스 총판 겸 상포 파트너)");
  const syinetId = await partnerId("세연아이넷");
  if (syinetId) {
    const serverDeals = await prisma.opportunity.findMany({
      where: { distributorId: syinetId },
      select: { id: true, title: true },
    });
    for (const d of serverDeals) {
      const isServer = /서버|server/i.test(d.title);
      log(`    ${d.title.slice(0, 36)} — ${isServer ? "서버 건 → 총판 유지" : "Sangfor 건 → 파트너로 이동"}`);
      if (APPLY && !isServer) {
        await prisma.opportunity.update({
          where: { id: d.id },
          data: { distributorId: null, partnerId: syinetId },
        });
      }
    }
  }

  log("\n[7] 총판 공백 → 넥시아스 (직판 거의 없음, Sangfor 총판은 모두 넥시아스)");
  const nexiasId = await partnerId(DEFAULT_DISTRIBUTOR);
  const noDistributor = await prisma.opportunity.count({ where: { distributorId: null } });
  log(`    총판 미지정 ${noDistributor}건 → ${DEFAULT_DISTRIBUTOR}`);
  if (APPLY && nexiasId) {
    await prisma.opportunity.updateMany({
      where: { distributorId: null },
      data: { distributorId: nexiasId },
    });
  }

  if (!APPLY) return;

  const [c, p, deals] = await Promise.all([
    prisma.customer.count(),
    prisma.partner.count(),
    prisma.opportunity.findMany({ select: { customerId: true, partnerId: true, distributorId: true } }),
  ]);
  log(
    `\n반영 완료 — 고객 ${c} · 파트너 ${p}\n` +
      `딜 ${deals.length}: 고객 ${deals.filter((d) => d.customerId).length} · ` +
      `파트너 ${deals.filter((d) => d.partnerId).length} · 총판 ${deals.filter((d) => d.distributorId).length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
