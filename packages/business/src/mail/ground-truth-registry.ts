/**
 * 거래처 도메인 ground-truth 레지스트리 (2026-07-10 재구축).
 *
 * 2026-06-30 원본 분류(고객15·파트너49)의 구조화 소스가 유실돼(파일·커밋·백업 전수 확인)
 * mail_messages 101개 도메인을 GROUND_TRUTH_CALIBRATION 규칙으로 재분류한 결과다.
 * 이번에는 코드로 영속화한다 — 이 파일이 정본이며, 수정은 사용자 정정을 거쳐 커밋으로만.
 *
 * 분류 기준(ai-classify-batch.ts GROUND_TRUTH_CALIBRATION과 동일):
 * - customer = 우리(베를로)가 Sangfor 제품을 파는 최종 사용자
 * - partner  = 총판/리셀러/SI/공급사. 한국 IT/SI는 증거 모호 시 partner
 * - vendor   = 글로벌/국내 SaaS·툴·카드·항공 등 우리가 소비하는 서비스
 * - system   = 릴레이/자동발신/정부 시스템
 * - needs_human = 증거 부족, 사용자 정정 대기
 *
 * evidence 표기: engagement=delivery_projects에 고객으로 존재 · fp-client=FinanceProject.client
 * (리셀러 컬럼)에 등장 · registry=기존 KNOWN_PARTNER_DOMAINS · rule=한국IT모호→partner 기본규칙
 * · mail=메일 왕복 실대화 · known=일반 상식(서비스 성격 명백)
 */

export type GroundTruthClass = "customer" | "partner" | "vendor" | "system" | "needs_human";

export interface GroundTruthEntry {
  domain: string;
  name: string;
  classification: GroundTruthClass;
  evidence: string;
}

export const GROUND_TRUTH_DOMAINS: readonly GroundTruthEntry[] = [
  { domain: "gsenc.com", name: "GS건설(GS E&C)", classification: "customer", evidence: "engagement: GS건설 VDI 리뉴얼·지에스이앤씨 Sangfor 도입" },
  { domain: "incar.co.kr", name: "인카금융서비스", classification: "customer", evidence: "engagement: 인카금융서비스 Sangfor 도입" },
  { domain: "kbinsure.co.kr", name: "KB손해보험", classification: "customer", evidence: "engagement: KB손해사정 서버가상화" },
  { domain: "chosun.com", name: "조선일보그룹", classification: "customer", evidence: "engagement: 조선일보그룹 리뉴얼·조선일로 JNS" },
  { domain: "lotte.net", name: "롯데그룹", classification: "customer", evidence: "engagement: 롯데건설 리뉴얼" },
  { domain: "sk.com", name: "SK", classification: "customer", evidence: "mail: outbound 위주 실대화, 대기업 최종수요" },
  { domain: "hyosung.com", name: "효성", classification: "customer", evidence: "mail: 왕복 실대화, 대기업 최종수요" },
  { domain: "vitalchem.com", name: "바이탈켐", classification: "customer", evidence: "mail: 왕복 실대화, 비IT 실수요 기업" },
  { domain: "kukjepharm.co.kr", name: "국제약품", classification: "customer", evidence: "mail: 왕복, 비IT 실수요 기업" },
  { domain: "tym.world", name: "TYM", classification: "customer", evidence: "mail: 왕복, 비IT(농기계) 실수요 기업" },
  { domain: "mistobrand.com", name: "미스토브랜드", classification: "customer", evidence: "mail: 왕복, 비IT 실수요 기업" },

  { domain: "nexias.co.kr", name: "넥시아스", classification: "partner", evidence: "registry: KNOWN_PARTNER_DOMAINS 기존 유일 엔트리" },
  { domain: "jngsystem.co.kr", name: "J&G System", classification: "partner", evidence: "fp-client: 인카금융그룹 FP 리셀러" },
  { domain: "1an.kr", name: "일에이엔", classification: "partner", evidence: "fp-client: 부산도시가스 FP 리셀러" },
  { domain: "gsitm.com", name: "GSITM", classification: "partner", evidence: "fp-client: 유니드 FP 리셀러" },
  { domain: "itnade.co.kr", name: "아이티네이드", classification: "partner", evidence: "fp-client: 동국대 FP 리셀러" },
  { domain: "az-tech.co.kr", name: "아지텍", classification: "partner", evidence: "fp-client: 일지테크 FP 리셀러" },
  { domain: "inotnx.co.kr", name: "이노티엔엑스", classification: "partner", evidence: "fp-client: 대통령경호처 FP 리셀러" },
  { domain: "ncloud24.com", name: "엔클라우드24", classification: "partner", evidence: "fp-client: 에스씨엘사이언스 FP 리셀러(NCloud)" },
  { domain: "doalltech.com", name: "두올테크", classification: "partner", evidence: "fp-client: 롯데건설-두올테크 FP" },
  { domain: "vclink.co.kr", name: "브이씨링크", classification: "partner", evidence: "rule+mail: 한국IT, 42건 왕복" },
  { domain: "jinplus.kr", name: "진플러스", classification: "partner", evidence: "rule+mail: 한국IT, 22건 왕복" },
  { domain: "syinet.com", name: "에스와이아이넷", classification: "partner", evidence: "rule+mail: 한국IT, 20건 왕복" },
  { domain: "goodus.com", name: "굿어스", classification: "partner", evidence: "mail: SNET 구매포탈 발주 채널" },
  { domain: "sgnine.co.kr", name: "에스지나인", classification: "partner", evidence: "rule+mail: 한국IT, 18건 왕복" },
  { domain: "ipageon.com", name: "아이페이지온", classification: "partner", evidence: "rule+mail: 한국IT, 14건 왕복" },
  { domain: "snetgroup.co.kr", name: "SNET그룹", classification: "partner", evidence: "mail: 구매포탈 발주(계약) 접수 채널" },
  { domain: "snetsystems.co.kr", name: "SNET시스템즈", classification: "partner", evidence: "rule: SNET 계열" },
  { domain: "hyperzen.co.kr", name: "하이퍼젠", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "uai.kr", name: "UAI", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "hccorp.co.kr", name: "에이치씨코퍼레이션", classification: "partner", evidence: "finance: 경비 지출처(공급사) 실거래" },
  { domain: "sejongnetworks.com", name: "세종네트웍스", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "trustarsecurity.com", name: "트러스타시큐리티", classification: "partner", evidence: "rule+mail: 보안 동종업" },
  { domain: "2bcomtech.co.kr", name: "투비컴텍", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "arisys.co.kr", name: "아리시스", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "iroo.co.kr", name: "아이루", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "uclix.com", name: "유클릭", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "isd.co.kr", name: "ISD", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "aitgw.co.kr", name: "에이아이티", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "cmtinfo.co.kr", name: "씨엠티정보", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "hankilwit.com", name: "한길위트", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "ocnt.co.kr", name: "오씨엔티", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "netand.co.kr", name: "넷앤드", classification: "partner", evidence: "known: 보안솔루션사" },
  { domain: "next-cel.com", name: "넥스트셀", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "lucis.co.kr", name: "루시스", classification: "partner", evidence: "rule+mail: 한국IT" },
  { domain: "leadon.co.kr", name: "리드온", classification: "partner", evidence: "rule: 한국IT" },
  { domain: "gtsolution.co.kr", name: "GT솔루션", classification: "partner", evidence: "rule: 한국IT, outbound" },
  { domain: "oceantechnology.co.kr", name: "오션테크놀로지", classification: "partner", evidence: "rule: 한국IT, outbound" },
  { domain: "goeunit.co.kr", name: "고은아이티", classification: "partner", evidence: "rule: 한국IT, outbound" },
  { domain: "netsafe.co.kr", name: "넷세이프", classification: "partner", evidence: "rule: 한국IT 보안" },
  { domain: "veganet.co.kr", name: "베가넷", classification: "partner", evidence: "rule: 한국IT" },
  { domain: "soontech.co.kr", name: "순테크", classification: "partner", evidence: "rule: 한국IT" },
  { domain: "sejongtelecom.net", name: "세종텔레콤", classification: "partner", evidence: "known: 통신/회선 공급사" },
  { domain: "miruware.com", name: "미루웨어", classification: "partner", evidence: "rule: 한국IT" },
  { domain: "rockplace.com", name: "락플레이스", classification: "partner", evidence: "known: 오픈소스 SI" },
  { domain: "safepoint.co.kr", name: "세이프포인트", classification: "partner", evidence: "rule: 한국IT 보안" },
  { domain: "supermicro.com", name: "Supermicro", classification: "partner", evidence: "known: 서버 하드웨어 공급사" },
  { domain: "chinatelecomglobal.com", name: "차이나텔레콤글로벌", classification: "partner", evidence: "mail: 왕복, 회선/서비스 공급" },

  { domain: "mail.notion.so", name: "Notion", classification: "vendor", evidence: "known: 협업 SaaS" },
  { domain: "makenotion.com", name: "Notion", classification: "vendor", evidence: "known" },
  { domain: "updates.notion.so", name: "Notion", classification: "vendor", evidence: "known" },
  { domain: "microsoft.com", name: "Microsoft", classification: "vendor", evidence: "known: M365 사용" },
  { domain: "mails.microsoft.com", name: "Microsoft", classification: "vendor", evidence: "known" },
  { domain: "mail.clickup.com", name: "ClickUp", classification: "vendor", evidence: "known: 협업 SaaS" },
  { domain: "gowid.com", name: "고위드", classification: "vendor", evidence: "known: 법인카드 SaaS" },
  { domain: "eformsign.com", name: "이폼사인", classification: "vendor", evidence: "known: 전자계약(릴레이)" },
  { domain: "slack.com", name: "Slack", classification: "vendor", evidence: "known" },
  { domain: "e.atlassian.com", name: "Atlassian", classification: "vendor", evidence: "known" },
  { domain: "popbill.com", name: "팝빌", classification: "vendor", evidence: "known: 세금계산서 릴레이" },
  { domain: "linkhubcorp.com", name: "링크허브", classification: "vendor", evidence: "known: 팝빌 계열" },
  { domain: "business.modusign.co.kr", name: "모두싸인", classification: "vendor", evidence: "known: 전자계약(릴레이)" },
  { domain: "modusign.co.kr", name: "모두싸인", classification: "vendor", evidence: "known" },
  { domain: "rememberapp.co.kr", name: "리멤버", classification: "vendor", evidence: "known" },
  { domain: "flow.team", name: "플로우", classification: "vendor", evidence: "known: 협업 SaaS" },
  { domain: "ecount.com", name: "이카운트", classification: "vendor", evidence: "known: ERP SaaS" },
  { domain: "wehago.com", name: "WEHAGO", classification: "vendor", evidence: "known: 회계 SaaS" },
  { domain: "fastfive.co.kr", name: "패스트파이브", classification: "vendor", evidence: "known: 오피스 임대" },
  { domain: "gabia.com", name: "가비아", classification: "vendor", evidence: "known: 도메인/호스팅" },
  { domain: "signgate.com", name: "사인게이트", classification: "vendor", evidence: "known: 인증(릴레이)" },
  { domain: "t.delta.com", name: "Delta Air Lines", classification: "vendor", evidence: "known: 항공" },
  { domain: "koreanair.com", name: "대한항공", classification: "vendor", evidence: "known: 항공" },
  { domain: "agoda.com", name: "Agoda", classification: "vendor", evidence: "known: 여행" },
  { domain: "lottecardmailcenter.net", name: "롯데카드", classification: "vendor", evidence: "known: 카드 명세 릴레이" },
  { domain: "lottecard.co.kr", name: "롯데카드", classification: "vendor", evidence: "known: 카드" },
  { domain: "mail.anthropic.com", name: "Anthropic", classification: "vendor", evidence: "known" },
  { domain: "connect.sparkmailapp.com", name: "Spark", classification: "vendor", evidence: "known: 메일앱" },
  { domain: "gadjet.io", name: "Gadjet", classification: "vendor", evidence: "known: SaaS" },
  { domain: "dell.com", name: "Dell", classification: "vendor", evidence: "known: 하드웨어 벤더(구매처 성격)" },
  { domain: "sangforsecurity.net", name: "Sangfor 마케팅", classification: "vendor", evidence: "known: 본사 마케팅 발신" },

  { domain: "bill36524.com", name: "빌36524", classification: "system", evidence: "registry: SYSTEM_SENDER_DOMAINS 기존" },
  { domain: "hometax.go.kr", name: "국세청 홈택스", classification: "system", evidence: "known: 정부 시스템" },
  { domain: "crew.you", name: "Autopilot 마케팅", classification: "system", evidence: "known: 마케팅 노이즈(기존 필터 대상)" },

  { domain: "poscodx.com", name: "포스코DX", classification: "needs_human", evidence: "SI사(파트너)이자 최종수요(고객) 양쪽 가능, 4건뿐" },
  { domain: "kt.com", name: "KT", classification: "needs_human", evidence: "inbound 2건뿐 — 고객 vs 마케팅 구분 불가" },
  { domain: "aveva.com", name: "AVEVA", classification: "needs_human", evidence: "글로벌 산업SW — vendor 규칙 vs 19건 실대화(공급 파트너?) 상충" },
  { domain: "clintl.kr", name: "씨엘인터내셔널(추정)", classification: "needs_human", evidence: "1건, 정보 부족" },
  { domain: "innern.net", name: "이너엔(추정)", classification: "needs_human", evidence: "outbound 1건뿐" },
  { domain: "lan.kr", name: "(불명)", classification: "needs_human", evidence: "outbound 1건뿐" },
  { domain: "bnfi.co.kr", name: "(불명)", classification: "needs_human", evidence: "outbound 1건뿐" },
  { domain: "ire.co.kr", name: "아이알이(추정)", classification: "needs_human", evidence: "outbound 1건뿐" },
  { domain: "efrikia.com", name: "에프리키아(추정)", classification: "needs_human", evidence: "outbound 2건뿐" },
] as const;

export function groundTruthByClass(cls: GroundTruthClass): GroundTruthEntry[] {
  return GROUND_TRUTH_DOMAINS.filter((e) => e.classification === cls);
}

export function groundTruthFor(domain: string): GroundTruthEntry | undefined {
  const normalized = domain.trim().toLowerCase();
  return GROUND_TRUTH_DOMAINS.find((e) => e.domain === normalized);
}
