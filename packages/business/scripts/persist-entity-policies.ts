/**
 * 도메인 → 역할 정책을 엔티티 판정표에서 영속화한다.
 *
 * 대화별 LLM 역할 태그를 다수결하면 안 된다 — 그렇게 했더니 최대 고객사(GS건설)가
 * 파트너로 뒤집혔다. "유통사의 직접 상대는 대개 파트너"라는 지시를 LLM이 실제
 * 최종고객에까지 적용했기 때문이다. 원문을 읽고 방향으로 판정한 표를 정본으로 쓴다.
 *
 * Usage: tsx packages/business/scripts/persist-entity-policies.ts [--apply]
 */
import { upsertPolicyMemory } from "../src/mail/mail-policy-memory";
import { prisma } from "@sangfor/db";

const APPLY = process.argv.includes("--apply");

type Role = "고객" | "파트너" | "벤더" | "내부";

// persona-entity.md 판정표 중 신뢰도 높음·중간만. 낮음/애매(⚠ 다수)는 사람 확인 대상이라
// 정책으로 굳히지 않는다 — 틀린 정책은 없는 정책보다 나쁘다.
const JUDGMENTS: Array<{ domain: string; company: string; role: Role; evidence: number; note?: string }> = [
  { domain: "sangfor.com", company: "Sangfor", role: "벤더", evidence: 44, note: "기술 티켓·라이선스 발급을 올려 받는 제조사" },
  { domain: "gsenc.com", company: "GS건설", role: "고객", evidence: 34, note: "VDI/HCI를 공급받는 최종사용기업. 최대 접점" },
  { domain: "nexias.co.kr", company: "넥시아스", role: "파트너", evidence: 25, note: "상위 공급선 — 베를로가 견적·라이선스를 의뢰해 받는다" },
  { domain: "jngsystem.co.kr", company: "JNG System", role: "파트너", evidence: 12, note: "자기 고객(인카금융 등)을 위해 베를로에 발주하는 SI" },
  { domain: "1an.kr", company: "일에이엔", role: "파트너", evidence: 10, note: "딜 등록·딜 보호를 요청하는 리셀러" },
  { domain: "syinet.com", company: "세연아이넷", role: "파트너", evidence: 9, note: "상위 HW 공급선 — 서버 견적을 의뢰해 받는다" },
  { domain: "gsitm.com", company: "GSITM", role: "고객", evidence: 8, note: "구매팀이 라이선스 갱신·발주. SRM 경유" },
  { domain: "vclink.co.kr", company: "브이씨링크", role: "파트너", evidence: 7, note: "KB손해사정 현장 설치를 함께 수행하는 SI" },
  { domain: "incar.co.kr", company: "인카금융서비스", role: "고객", evidence: 5 },
  { domain: "itnade.co.kr", company: "아이티네이드", role: "파트너", evidence: 5, note: "동국대병원 발주를 함께 처리하는 SI" },
  { domain: "sgnine.co.kr", company: "에스지나인", role: "고객", evidence: 5 },
  { domain: "isd.co.kr", company: "인성디지탈", role: "파트너", evidence: 4 },
  { domain: "chosun.com", company: "조선일보JNS", role: "고객", evidence: 4 },
  { domain: "ipageon.com", company: "아이페이지온", role: "고객", evidence: 4 },
  { domain: "jinplus.kr", company: "진플러스", role: "파트너", evidence: 4, note: "DRB동일 유지보수를 담당하는 파트너(검증자 교정)" },
  { domain: "goodus.com", company: "굿어스", role: "파트너", evidence: 3 },
  { domain: "vitalchem.com", company: "VitalChem", role: "고객", evidence: 3 },
];

// 분류기가 실제로 조회하는 타입에 맞춰야 매칭된다. 파트너·벤더는 도메인으로(
// known_partner_domain → knownPartnerDomains), 고객은 회사명으로만 조회한다
// (known_customer_domain 타입이 없다 — 도메인 기반 고객 매칭은 후속 과제).
function entriesFor(j: { domain: string; company: string; role: Role }) {
  if (j.role === "고객") {
    return [{ type: "known_customer_name", key: j.company }];
  }
  return [
    { type: "known_partner_domain", key: j.domain },
    { type: "known_partner_name", key: j.company },
  ];
}

async function main() {
  console.log(`판정 ${JUDGMENTS.length}건${APPLY ? "" : " (dry-run — --apply로 저장)"}`);

  let written = 0;
  for (const j of JUDGMENTS) {
    const entries = entriesFor(j);
    console.log(
      `  ${j.domain.padEnd(20)} → ${j.role} (근거 ${j.evidence}건) [${entries.map((e) => e.type).join(", ")}]`,
    );
    if (!APPLY) continue;
    for (const entry of entries) {
      written++;
      await upsertPolicyMemory({
        memoryType: entry.type,
        key: entry.key,
        label: `${j.company} (${j.domain}) → ${j.role}${j.note ? ` — ${j.note}` : ""}`,
        valueJson: {
          source: "mail-history-entity-map",
          company: j.company,
          domain: j.domain,
          role: j.role,
          evidenceCount: j.evidence,
          note: j.note ?? null,
        },
        status: "approved",
        confidence: Math.min(95, 60 + j.evidence),
      });
    }
  }
  if (APPLY) console.log(`\n정책 행 ${written}건 기록`);

  if (APPLY) {
    console.log(`\n저장 후 — PolicyMemory ${await prisma.policyMemory.count()}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
