export const dynamic = "force-dynamic";

import Link from "next/link";
import { listOpportunities } from "@sangfor/business";
import { prisma } from "@sangfor/db";

// ── 계기판 매핑 헬퍼 ────────────────────────────────────────────────
// 메일 파생 후보의 유형 → 담당 역할 AI (도메인 에이전트)
const ROLE: Record<string, { cls: string; badge: string; label: string }> = {
  customer: { cls: "mk", badge: "MK", label: "마케팅 AI" },
  partner: { cls: "mk", badge: "MK", label: "마케팅 AI" },
  opportunity: { cls: "ps", badge: "PS", label: "프리세일즈 AI" },
  poc: { cls: "en", badge: "EN", label: "엔지니어 AI" },
  task: { cls: "sa", badge: "SA", label: "영업 AI" },
};
function roleFor(t: string) {
  return ROLE[t] ?? { cls: "sa", badge: "SA", label: "영업 AI" };
}
const TYPE_KO: Record<string, string> = {
  customer: "고객 후보",
  partner: "파트너 후보",
  opportunity: "영업기회 후보",
  poc: "PoC 후보",
  task: "작업 후보",
};
function domainOf(sender: string | null): string {
  if (!sender) return "—";
  const at = sender.indexOf("@");
  return at >= 0 ? sender.slice(at + 1) : sender;
}
function daysUntil(d: Date | null): number | null {
  if (!d) return null;
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}
function won(fmt: number): string {
  return "₩" + Math.round(fmt).toLocaleString("ko-KR");
}

// 5색 검증 콘솔 — 정직성: 후보별 컬러 검증 데이터는 아직 백엔드 미연동.
// 신뢰도를 균일 레벨로 표시하고, verdict 라벨로 "신뢰도이지 5채널 검증 아님"을 명시.
function consoleLevel(confidence: number): "pass" | "mid" | "wait" {
  if (confidence >= 80) return "pass";
  if (confidence >= 60) return "mid";
  return "wait";
}
function Console({ confidence }: { confidence: number }) {
  const lv = consoleLevel(confidence);
  const chans = ["b", "r", "o", "g", "t"] as const;
  return (
    <div className="console">
      <div className="eq" aria-hidden>
        {chans.map((c) => (
          <div key={c} className={`ch ${c} ${lv}`}>
            <div className="track">
              <div className="lv" />
            </div>
            <div className="lt">{c.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <div className="verdict">
        <b>AI 신뢰도 {confidence}%</b>
        <span className="sub">5색 컬러 검증 연동 예정</span>
      </div>
    </div>
  );
}

export default async function MyWorkPage() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [oppResult, approvals, inbox, pendingTotal, todayCount] =
    await Promise.all([
      listOpportunities().catch(() => null),
      prisma.mailDerivedCandidate.findMany({
        where: { status: "proposed" },
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: 6,
      }),
      prisma.mailDerivedCandidate.findMany({
        where: { status: "proposed" },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
      prisma.mailDerivedCandidate.count({ where: { status: "proposed" } }),
      prisma.mailDerivedCandidate.count({
        where: { status: "proposed", createdAt: { gte: startOfToday } },
      }),
    ]);

  // 임박 — 시간 트리거: 마감일이 다가오는 열린 영업기회
  const imminent = (oppResult ?? [])
    .filter((o) => o.stage !== "WON" && o.stage !== "LOST" && o.closeDate)
    .map((o) => ({
      id: o.id,
      title: o.title,
      customer: o.customer?.name ?? "",
      stage: o.stage,
      d: daysUntil(o.closeDate),
    }))
    .filter((o) => o.d !== null && o.d <= 120)
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
    .slice(0, 5);

  const flagged = approvals.filter((c) => c.confidence < 60).length;

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">관제 · CONTROL</div>
          <h1>내 업무</h1>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}
          >
            역할 AI 초안 → 5색 검증 → 사장님 결정
          </div>
        </div>
        <div className="clock">
          승인 대기 <b>{pendingTotal}</b>
          <br />
          임박 {imminent.length} · 오늘 인입 {todayCount}
        </div>
      </div>

      {/* 브리핑 — AI 팀 집단 목소리 */}
      <section className="brief">
        <div className="bar">
          <span className="d" />
          <span className="tt">AI 팀 · 브리핑</span>
          <span className="meta">실시간 · 후보 {pendingTotal}건 대기</span>
        </div>
        <div className="body">
          <p>
            메일 인텔리전스가 <span className="k">{pendingTotal}건</span>의 후보를
            분류해 사장님 승인을 기다립니다. 오늘 새 인입{" "}
            <span className="k">{todayCount}건</span>, 마감 임박 영업기회{" "}
            <span className="k">{imminent.length}건</span>.
            {flagged > 0 ? (
              <>
                {" "}
                <span className="rf">
                  신뢰도 60% 미만 {flagged}건은 검토가 필요합니다.
                </span>
              </>
            ) : (
              <> 신뢰도 낮은 항목 없이 정상입니다.</>
            )}
          </p>
          <div className="chips">
            <span className="chip">
              <i style={{ background: "var(--ck-gray)" }} />
              <b>{pendingTotal}</b>
              <s>승인 대기 → 역할 AI</s>
            </span>
            <span className="chip">
              <i style={{ background: "var(--ck-blue)" }} />
              <b>{todayCount}</b>
              <s>오늘 인입 → 마케팅 AI</s>
            </span>
            <span className="chip">
              <i style={{ background: "var(--ck-orange)" }} />
              <b>{imminent.length}</b>
              <s>임박 마감 → 영업 AI</s>
            </span>
          </div>
        </div>
      </section>

      <div className="ck-cols">
        {/* 승인 큐 */}
        <div>
          <div className="sh">
            <h2>내 승인 대기</h2>
            <span className="n">{pendingTotal}</span>
            <span className="flow">초안 → 5색 검증 → 결정</span>
          </div>

          {approvals.length === 0 ? (
            <p className="empty">승인 대기 항목이 없습니다.</p>
          ) : (
            approvals.map((c) => {
              const role = roleFor(c.candidateType);
              return (
                <div className="slip" key={c.id}>
                  <div className="top">
                    <div className={`rolech ${role.cls}`}>{role.badge}</div>
                    <div className="meta">
                      <div className="l1">
                        <b>{c.title}</b>
                        <span className="wf n">신규영업</span>
                      </div>
                      <div className="l2">
                        <b>{TYPE_KO[c.candidateType] ?? c.candidateType}</b> ·{" "}
                        {role.label} · {domainOf(c.sourceSender)}
                      </div>
                    </div>
                    <div className="amt">
                      <b>{c.confidence}%</b>
                      <small>신뢰도</small>
                    </div>
                  </div>
                  {c.summary ? <div className="draft">{c.summary}</div> : null}
                  <Console confidence={c.confidence} />
                  <div className="act">
                    <Link
                      href={`/approvals/mail-candidates/${c.id}`}
                      className="btn ap"
                    >
                      열어서 결정
                    </Link>
                    <Link href="/approvals" className="btn">
                      전체 승인함
                    </Link>
                    <span className="ago mono">
                      {c.sourceReceivedAt
                        ? new Date(c.sourceReceivedAt).toLocaleDateString(
                            "ko-KR"
                          )
                        : "메일 파생"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 우측 계기 레일 */}
        <div>
          <div className="pnl">
            <div className="ph">
              <b>임박</b>
              <span className="co mlbl">시간 트리거</span>
            </div>
            {imminent.length === 0 ? (
              <p className="empty">마감 임박 영업기회가 없습니다.</p>
            ) : (
              <div className="ruler">
                {imminent.map((o) => {
                  const cls =
                    (o.d ?? 0) <= 3 ? "u" : (o.d ?? 0) <= 30 ? "s" : "o";
                  return (
                    <div className={`tick ${cls}`} key={o.id}>
                      <span className={`dd ${cls}`}>
                        {(o.d ?? 0) <= 0 ? "오늘" : `D-${o.d}`}
                      </span>
                      <b>{o.title}</b>
                      <span>{o.customer || "고객 미지정"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pnl">
            <div className="ph">
              <b>인입 미분류</b>
              <span className="co mlbl">원탭 분류</span>
            </div>
            {inbox.length === 0 ? (
              <p className="empty">새 인입이 없습니다.</p>
            ) : (
              inbox.map((c) => (
                <div className="ibx" key={c.id}>
                  <span className="src">메일</span>
                  <div className="x">
                    <b>{c.title}</b>
                    <span>
                      추정{" "}
                      <em>
                        {TYPE_KO[c.candidateType] ?? c.candidateType} ·{" "}
                        {domainOf(c.sourceSender)}
                      </em>
                    </span>
                  </div>
                  <Link
                    href={`/approvals/mail-candidates/${c.id}`}
                    className="tap"
                  >
                    확인
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
