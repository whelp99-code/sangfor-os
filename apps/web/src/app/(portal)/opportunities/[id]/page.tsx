export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getOpportunityDetail,
  getEngagementByOpportunity,
} from "@sangfor/business";
import { won } from "@/lib/cockpit";

// OpportunityStage → 편대 레인 위치(0 마케팅 · 1 영업 · 2 프리세일즈 · 3 엔지니어 · 4 완료)
const STAGE_LANE: Record<string, number> = {
  LEAD: 1,
  QUALIFIED: 1,
  PROPOSAL: 2,
  NEGOTIATION: 2,
  POC: 3,
  WON: 4,
  LOST: 2,
};
const STAGE_KO: Record<string, string> = {
  LEAD: "리드",
  QUALIFIED: "검증",
  PROPOSAL: "제안",
  NEGOTIATION: "협상",
  POC: "PoC",
  WON: "수주",
  LOST: "이탈",
};
const LANES = [
  { cls: "mk", badge: "MK", nm: "마케팅", sub: "인입 분류" },
  { cls: "sa", badge: "SA", nm: "영업", sub: "미팅·니즈" },
  { cls: "ps", badge: "PS", nm: "프리세일즈", sub: "제안·견적" },
  { cls: "en", badge: "EN", nm: "엔지니어", sub: "PoC·구축" },
  { cls: "cf", badge: "CF", nm: "완료", sub: "PO·정산" },
];
const ROLE_LABEL = ["마케팅 AI", "영업 AI", "프리세일즈 AI", "엔지니어 AI", "CFO AI"];

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opp = await getOpportunityDetail(id).catch(() => null);
  if (!opp) notFound();
  const engagement = await getEngagementByOpportunity(id).catch(() => null);

  const cur = STAGE_LANE[opp.stage] ?? 1;
  const isLost = opp.stage === "LOST";
  const isWon = opp.stage === "WON";
  const nowRole = ROLE_LABEL[Math.min(cur, 4)];

  const checklist = engagement?.checklistItems ?? [];
  const deliveryDocs = engagement?.generatedDocuments ?? [];
  const pocs = engagement?.pocProjects ?? [];
  const stageEvents = opp.stageEvents ?? [];

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">신규영업 {opp.code ? `· ${opp.code}` : ""}</div>
          <h1>{opp.title}</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            담당 {nowRole} · 단계 {STAGE_KO[opp.stage] ?? opp.stage}
            {opp.customer?.name ? ` · ${opp.customer.name}` : ""}
          </div>
        </div>
        <div className="big-r">
          <b>{won(opp.amount ? Number(opp.amount) : 0)}</b>
          <br />
          예상 규모 · 확률 {opp.probability}%
        </div>
      </div>

      <section className="relay">
        <div className="rh">
          <span className="mlbl" style={{ color: "var(--ck-muted)" }}>
            편대 레인 · 역할 AI 릴레이
          </span>
          <span className="now">
            ● {isWon ? "완료 · 수주" : isLost ? "이탈" : `지금: ${nowRole}`}
          </span>
        </div>
        <div className="lanes">
          {LANES.map((l, i) => {
            const state = i < cur ? "done" : i === cur ? "now" : "up";
            const laneEl = (
              <div className={`lane ${state}`} key={l.cls}>
                <div className="bar" />
                {state === "now" && !isWon ? <div className="baton" /> : null}
                <div className="who">
                  <div className={`rolech ${l.cls}`}>{l.badge}</div>
                  <div className="nm">
                    {l.nm}
                    <small>{l.sub}</small>
                  </div>
                </div>
              </div>
            );
            if (i === 2) {
              return [
                laneEl,
                <div className={`gate ${cur > 2 ? "passed" : ""}`} key="g1">
                  <div className="di" />
                  <div className="gl">
                    G1
                    <br />
                    1차승인
                  </div>
                </div>,
              ];
            }
            if (i === 3) {
              return [
                laneEl,
                <div className={`gate ${isWon ? "passed" : ""}`} key="g2">
                  <div className="di" />
                  <div className="gl">
                    G2
                    <br />
                    최종승인
                  </div>
                </div>,
              ];
            }
            return laneEl;
          })}
        </div>
      </section>

      <div className="ck-cols">
        <div>
          <div className="sh">
            <h2>산출물</h2>
            <span className="flow">단계별 · 5색 검증 연동 예정</span>
          </div>

          <div className="art">
            <div className="rolech ps">PS</div>
            <div className="x">
              <b>
                제안서
                {deliveryDocs.length > 0 ? (
                  <span className="stt dr">{deliveryDocs.length}건</span>
                ) : (
                  <span className="stt wa">미생성</span>
                )}
              </b>
              <span>프리세일즈 AI · 제안·견적 단계</span>
            </div>
            <Link href="/proposals" className="go">열기</Link>
          </div>

          <div className="art">
            <div className="rolech en">EN</div>
            <div className="x">
              <b>
                PoC 체크리스트
                {pocs.length > 0 ? (
                  <span className="stt dr">{pocs.length}건</span>
                ) : (
                  <span className="stt wa">{cur >= 3 ? "진행" : "G1 이후"}</span>
                )}
              </b>
              <span>엔지니어 AI · 기술미팅→시나리오→시행→결과보고서</span>
            </div>
            <Link href="/poc" className="go">열기</Link>
          </div>

          <div className="art">
            <div className="rolech en">EN</div>
            <div className="x">
              <b>
                구축 체크리스트
                {checklist.length > 0 ? (
                  <span className="stt dr">
                    {checklist.filter((c) => c.status === "done").length}/{checklist.length}
                  </span>
                ) : (
                  <span className="stt wa">{isWon ? "진행" : "G2 이후"}</span>
                )}
              </b>
              <span>PO확인→구매요청→설치일→구축→완료보고서</span>
            </div>
            <Link href="/delivery" className="go">열기</Link>
          </div>
        </div>

        <div>
          <div className="pnl mini" style={{ marginBottom: 16 }}>
            <div className="ph">
              <b>고객사</b>
              <span className="co mlbl">허브</span>
            </div>
            <b>{opp.customer?.name ?? "고객 미지정"}</b>
            <div style={{ marginTop: 10 }}>
              <div className="kv">
                <span className="k">단계</span>
                <span className="v">{STAGE_KO[opp.stage] ?? opp.stage}</span>
              </div>
              <div className="kv">
                <span className="k">거래 상태</span>
                <span className="v">{opp.dealStatus}</span>
              </div>
              <div className="kv">
                <span className="k">마감일</span>
                <span className="v">
                  {opp.closeDate ? new Date(opp.closeDate).toLocaleDateString("ko-KR") : "—"}
                </span>
              </div>
              {opp.partner?.name ? (
                <div className="kv">
                  <span className="k">파트너</span>
                  <span className="v">{opp.partner.name}</span>
                </div>
              ) : null}
            </div>
            {opp.customer?.id ? (
              <Link
                href={`/customers/${opp.customer.id}`}
                className="go"
                style={{ display: "inline-block", marginTop: 12 }}
              >
                고객 허브 →
              </Link>
            ) : null}
          </div>

          <div className="pnl" style={{ marginBottom: 16 }}>
            <div className="ph">
              <b>단계 이력</b>
            </div>
            {stageEvents.length === 0 ? (
              <p className="empty">단계 전환 기록이 없습니다.</p>
            ) : (
              <div className="tl">
                {stageEvents.slice(0, 6).map((e) => (
                  <div className="tli" key={e.id}>
                    <b>
                      {STAGE_KO[e.toStage] ?? e.toStage}
                      {e.fromStage ? ` ← ${STAGE_KO[e.fromStage] ?? e.fromStage}` : ""}
                    </b>
                    <span>{new Date(e.createdAt).toLocaleDateString("ko-KR")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="next">
            <span className="mlbl">다음 관문</span>
            <b>{isWon ? "수주 완료" : cur < 3 ? "G1 · 1차 승인" : "G2 · 최종 승인"}</b>
            <span>
              {isWon
                ? "정산·완료보고서"
                : cur < 3
                ? "제안·견적 확정 시 사장님 게이트"
                : "PoC 결과 확정 시 사장님 게이트"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
