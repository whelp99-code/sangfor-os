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

// 2026-07-14 대표 확인 완료(데이터확인요청_20260714.xlsx). 메일 분석이 "낮음"으로
// 남겼던 판정을 사람이 확답했다 — 그중 GSITM·에스지나인·트러스타시큐리티·루키스는
// 내가 고객으로 본 것이 전부 파트너였다. 추측이 아니라 확인된 사실만 여기 둔다.
const JUDGMENTS: Array<{ domain: string; company: string; role: Role; evidence: number; note?: string }> = [
  { domain: "sangfor.com", company: "Sangfor", role: "벤더", evidence: 44, note: "제조사(상포). 기술 티켓·라이선스 발급을 올려 받는다" },
  { domain: "gsenc.com", company: "GS건설", role: "고객", evidence: 34, note: "최대 최종고객. 구매는 GSITM이 대행한다" },
  { domain: "nexias.co.kr", company: "넥시아스", role: "파트너", evidence: 25, note: "Sangfor 총판. 직판은 거의 없고 Sangfor 총판은 모두 여기다" },
  { domain: "gsitm.com", company: "GSITM", role: "파트너", evidence: 26, note: "GS건설의 구매대행 파트너. 계약번호를 발행한다 — 고객이 아니다" },
  { domain: "jngsystem.co.kr", company: "JNG System", role: "파트너", evidence: 12, note: "SI. 자기 고객(인카금융 등)을 위해 발주" },
  { domain: "1an.kr", company: "일에이엔", role: "파트너", evidence: 10, note: "리셀러(부산). 딜 등록·딜 보호를 요청" },
  { domain: "syinet.com", company: "세연아이넷", role: "파트너", evidence: 9, note: "케이투스 총판 겸 Sangfor 파트너 — 서버 건에서만 총판이다" },
  { domain: "hyosung.com", company: "효성ITX", role: "파트너", evidence: 3, note: "상포(Sangfor) 총판사" },
  { domain: "vclink.co.kr", company: "브이씨링크", role: "파트너", evidence: 7, note: "설치 SI. KB손해사정 현장" },
  { domain: "incar.co.kr", company: "인카금융서비스", role: "고객", evidence: 5 },
  { domain: "itnade.co.kr", company: "아이티네이드", role: "파트너", evidence: 5, note: "SI. 동국대병원 발주" },
  { domain: "sgnine.co.kr", company: "에스지나인", role: "파트너", evidence: 8 },
  { domain: "isd.co.kr", company: "인성디지탈", role: "파트너", evidence: 4, note: "현재 접점 없음" },
  { domain: "chosun.com", company: "디지틀조선일보", role: "파트너", evidence: 4, note: "조선일보그룹 IT 조달 창구. 계열사(조선일보JNS·게임조선)가 최종고객" },
  { domain: "ipageon.com", company: "아이페이지온", role: "고객", evidence: 4 },
  { domain: "jinplus.kr", company: "진플러스", role: "파트너", evidence: 4, note: "부산회사. DRB동일 유지보수 담당" },
  { domain: "goodus.com", company: "굿어스", role: "파트너", evidence: 3 },
  // 국내 상호는 케이브이머티리얼즈, vitalchem.com은 중국 본사 도메인이다.
  // 도메인 루트("Vitalchem")를 이름으로 쓰면 같은 회사가 두 행으로 갈라진다.
  { domain: "vitalchem.com", company: "케이브이머티리얼즈", role: "고객", evidence: 3 },
  { domain: "uai.kr", company: "유에이아이", role: "파트너", evidence: 4, note: "설치 SI" },
  { domain: "hccorp.co.kr", company: "에이치씨코퍼레이션", role: "파트너", evidence: 5, note: "파트너 겸 서버 총판" },
  { domain: "ocnt.co.kr", company: "오우션테크", role: "파트너", evidence: 2, note: "서버 총판" },
  { domain: "az-tech.co.kr", company: "아지텍", role: "파트너", evidence: 4 },
  { domain: "aitgw.co.kr", company: "에이아이티", role: "파트너", evidence: 3, note: "부산" },
  { domain: "lucis.co.kr", company: "루키스", role: "파트너", evidence: 3, note: "KB손해사정 녹취 솔루션 업체" },
  { domain: "trustarsecurity.com", company: "트러스타시큐리티", role: "파트너", evidence: 2, note: "선진엔지니어링이 최종고객" },
  { domain: "sk.com", company: "코원에너지", role: "고객", evidence: 2, note: "SK 자회사" },
  { domain: "kukjepharm.co.kr", company: "국제약품", role: "고객", evidence: 1 },
  { domain: "tym.world", company: "TYM", role: "고객", evidence: 1 },
];

// 분류기가 실제로 조회하는 타입에 맞춰야 매칭된다. 파트너·벤더는 도메인으로(
// known_partner_domain → knownPartnerDomains), 고객은 회사명으로만 조회한다
// (known_customer_domain 타입이 없다 — 도메인 기반 고객 매칭은 후속 과제).
// 같은 회사를 메일마다 다르게 쓴다(오타·로마자·구 상호). 별칭 키를 정식 상호 label로
// 걸어두면 그렇게 들어와도 후보가 정식 상호로 만들어진다 — label이 곧 엔티티 이름이다.
const ALIASES: Record<string, string[]> = {
  인카금융서비스: ["Incar", "잉카금융그룹", "잉카금융서비스", "인카금융그룹"],
  케이브이머티리얼즈: ["Vitalchem", "KV메트리얼즈", "KV머티리얼즈"],
  GS건설: ["Gsenc", "GS E&C"],
  디지틀조선일보: ["디지탈조선", "디지털조선"],
};

function entriesFor(j: { domain: string; company: string; role: Role }) {
  const nameType = j.role === "고객" ? "known_customer_name" : "known_partner_name";
  const aliases = (ALIASES[j.company] ?? []).map((key) => ({ type: nameType, key }));

  if (j.role === "고객") {
    return [{ type: nameType, key: j.company }, ...aliases];
  }
  return [
    { type: "known_partner_domain", key: j.domain },
    { type: nameType, key: j.company },
    ...aliases,
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
        // label은 설명문이 아니라 회사명이어야 한다 — 분류기가 이 값을 그대로 후보의
        // 엔티티 이름으로 쓴다(classify-rules.ts). 설명을 넣었더니 "syinet.com → 파트너
        // (메일 이력 3건 근거)"라는 이름의 후보가 만들어졌다. 근거는 valueJson에 둔다.
        label: j.company,
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
