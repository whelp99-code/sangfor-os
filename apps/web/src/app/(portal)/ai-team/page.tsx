export const dynamic = "force-dynamic";

import { prisma } from "@sangfor/db";
import {
  evaluateCandidateColorGate,
  getObservabilitySummary,
  isAutopilotEnabled,
} from "@sangfor/business";
import { revalOf } from "@/lib/cockpit";
import { AutopilotKillSwitch } from "@/components/cockpit/autopilot-kill-switch";

const DOMAINS = [
  { key: "marketing", cls: "mk", badge: "MK", nm: "마케팅", sub: "인입·분류" },
  { key: "sales", cls: "sa", badge: "SA", nm: "영업", sub: "미팅·견적" },
  { key: "presales", cls: "ps", badge: "PS", nm: "프리세일즈", sub: "제안·PoC" },
  { key: "engineer", cls: "en", badge: "EN", nm: "엔지니어", sub: "PoC·구축" },
  { key: "cfo", cls: "cf", badge: "CF", nm: "CFO", sub: "견적·정산" },
];
const LENSES = [
  { cls: "b", nm: "Blue · 기술", sub: "PoC 시나리오·구축계획 타당성" },
  { cls: "r", nm: "Red · 리스크", sub: "견적·계약·보안 리스크" },
  { cls: "o", nm: "Orange · 가치", sub: "페인 부합·마진" },
  { cls: "g", nm: "Gray · 근거", sub: "제안서·보고서 완결성" },
  { cls: "t", nm: "Teal · UX", sub: "고객 전달물 명료성" },
];

// 무수정율 → 자율도 단계 인덱스 (0 관찰 · 1 초안 · 2 자동 · 3 위임)
function autonomyStep(total: number, approved: number): number {
  if (total < 5) return 0;
  const rate = approved / total;
  if (rate >= 0.9) return 3;
  if (rate >= 0.6) return 2;
  return 1;
}
const STEP_LABELS = ["관찰", "초안", "자동", "위임"];
const MODE_KO: Record<string, string> = { observe: "관찰", suggest: "제안", auto: "자동" };
const REVERSAL_WINDOW_DAYS = 7;

async function computeReversalRate7d(): Promise<{ rate: number; reversed: number; total: number }> {
  const reversalSince = new Date(Date.now() - REVERSAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const autoDecisions = await prisma.domainDecisionLog.findMany({
    where: { actor: "ai", actionType: "autopilot_approve", createdAt: { gte: reversalSince } },
    select: { caseRef: true, createdAt: true },
  });
  let reversed = 0;
  for (const d of autoDecisions) {
    if (!d.caseRef) continue;
    const laterRejection = await prisma.domainDecisionLog.findFirst({
      where: {
        caseRef: d.caseRef,
        actor: { in: ["human", "sales"] },
        outcome: "rejected",
        createdAt: { gt: d.createdAt },
      },
      select: { id: true },
    });
    if (laterRejection) reversed++;
  }
  const rate = autoDecisions.length > 0 ? Math.round((reversed / autoDecisions.length) * 100) : 0;
  return { rate, reversed, total: autoDecisions.length };
}

export default async function AiTeamPage() {
  const [byDomainOutcome, memByDomain, totalDecisions, corrections] =
    await Promise.all([
      prisma.domainDecisionLog.groupBy({
        by: ["domain", "outcome"],
        _count: { _all: true },
      }),
      prisma.domainMemory.groupBy({
        by: ["domain"],
        where: { status: "active" },
        _count: { _all: true },
      }),
      prisma.domainDecisionLog.count(),
      prisma.domainDecisionLog.findMany({
        where: { outcome: "corrected" },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { domain: true, decisionType: true, createdAt: true, outcome: true },
      }),
    ]);

  // 컬러 게이트 실 집계 — 대기 후보에 결정형 5-렌즈 게이트 적용
  const gateCandidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "proposed" },
    select: { candidateType: true, confidence: true, summary: true, metadata: true },
    take: 400,
  });
  const lensAgg: Record<string, { pass: number; fail: number }> = {
    blue: { pass: 0, fail: 0 }, red: { pass: 0, fail: 0 }, orange: { pass: 0, fail: 0 },
    gray: { pass: 0, fail: 0 }, teal: { pass: 0, fail: 0 },
  };
  let gatePassCount = 0;
  for (const c of gateCandidates) {
    const g = evaluateCandidateColorGate({
      candidateType: c.candidateType,
      confidence: c.confidence,
      revalidation: revalOf(c.metadata),
      hasSummary: !!c.summary,
    });
    if (g.pass) gatePassCount += 1;
    for (const k of ["blue", "red", "orange", "gray", "teal"] as const) {
      if (g.lenses[k] === "pass") lensAgg[k].pass += 1;
      else if (g.lenses[k] === "fail") lensAgg[k].fail += 1;
    }
  }

  // Autopilot 관제 — 정책·킬스위치·최근 자동 결정·뒤집힘율 (전부 실쿼리)
  const [autopilotEnabled, policies, recentAutoDecisions, llmObservability] = await Promise.all([
    isAutopilotEnabled(),
    prisma.autonomyPolicy.findMany({
      orderBy: [{ domain: "asc" }, { decisionType: "asc" }],
      select: { domain: true, decisionType: true, mode: true, minAutonomy: true, minSamples: true },
    }),
    prisma.domainDecisionLog.findMany({
      where: { actor: "ai", actionType: "autopilot_approve" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, caseRef: true, outcome: true, createdAt: true },
    }),
    getObservabilitySummary(),
  ]);

  const reversal = await computeReversalRate7d();

  const stat = (domain: string) => {
    const rows = byDomainOutcome.filter((r) => r.domain === domain);
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const approved = rows.find((r) => r.outcome === "approved")?._count._all ?? 0;
    const mem = memByDomain.find((m) => m.domain === domain)?._count._all ?? 0;
    return { total, approved, mem };
  };

  const totalCorrected =
    byDomainOutcome.find((r) => r.outcome === "corrected")?._count._all ?? 0;

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">기반 · 내 AI 직원들</div>
          <h1>AI 팀</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            역할 AI 5 · 컬러 검증 AI 5 · 누적 결정 {totalDecisions}건
          </div>
        </div>
        <div className="big-r">
          누적 결정
          <br />
          <b>{totalDecisions}</b>
        </div>
      </div>

      <div className="sh">
        <h2>역할 AI</h2>
        <span className="n">5</span>
        <span className="flow">자율도 · 관찰→초안→자동→위임</span>
      </div>
      <div className="grid5">
        {DOMAINS.map((d) => {
          const s = stat(d.key);
          const step = autonomyStep(s.total, s.approved);
          const rate = s.total > 0 ? Math.round((s.approved / s.total) * 100) : 0;
          return (
            <div className="role" key={d.key}>
              <div className="rt">
                <div className={`rolech ${d.cls}`}>{d.badge}</div>
                <div className="nm">
                  {d.nm}
                  <small>{d.sub}</small>
                </div>
              </div>
              <div className="stat">
                <span>누적 결정</span>
                <b>{s.total}건</b>
              </div>
              <div className="stat">
                <span>무수정 승인</span>
                <b>{rate}%</b>
              </div>
              <div className="stat">
                <span>학습 메모리</span>
                <b>{s.mem}</b>
              </div>
              <div className="dial">
                <div className="dl">자율도</div>
                <div className="steps">
                  {STEP_LABELS.map((lbl, i) => (
                    <span
                      key={lbl}
                      className={`step ${i < step ? "fill" : i === step ? "cur" : ""}`}
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
                {s.total === 0 ? (
                  <div
                    className="nudge"
                    style={{
                      background: "var(--ck-panel-2)",
                      borderColor: "var(--ck-line-2)",
                      color: "var(--ck-muted)",
                    }}
                  >
                    활동 없음 — 관찰 유지
                  </div>
                ) : rate >= 60 ? (
                  <div className="nudge">
                    <b>▲</b> 자율도 상향 제안 — 무수정 {rate}%
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ck-cols">
        <div className="pnl">
          <div className="ph">
            <b>컬러 검증 AI</b>
            <span className="co mlbl">5 렌즈</span>
          </div>
          {LENSES.map((l) => {
            const full = { b: "blue", r: "red", o: "orange", g: "gray", t: "teal" }[l.cls]!;
            const agg = lensAgg[full];
            return (
              <div className="colr" key={l.cls}>
                <span className={`sw ${l.cls}`} />
                <div className="x">
                  <b>{l.nm}</b>
                  <span>{l.sub}</span>
                </div>
                <div className="m">
                  <span className="p">통과 {agg.pass}</span>
                  {agg.fail > 0 ? <> · <span className="f">보류 {agg.fail}</span></> : null}
                </div>
              </div>
            );
          })}
          <p className="empty" style={{ paddingTop: 10 }}>
            대기 후보 {gateCandidates.length}건에 결정형 5-렌즈 게이트 적용 · 전체 통과{" "}
            {gatePassCount}건. (도메인 에이전트 LLM 게이트는 후속 연동)
          </p>
        </div>

        <div className="pnl">
          <div className="ph">
            <b>학습 루프</b>
            <span className="co mlbl">사람 수정 → 학습</span>
          </div>
          {corrections.length === 0 ? (
            <p className="empty">
              사람 수정 {totalCorrected}건 · 학습 메모리 축적 대기.
            </p>
          ) : (
            corrections.map((c, i) => (
              <div className="learn" key={i}>
                <div className="ic">↗</div>
                <div className="x">
                  <b>
                    {c.domain} · {c.decisionType} 수정 반영
                  </b>
                  <span>
                    {c.outcome ?? "corrected"} ·{" "}
                    {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                </div>
              </div>
            ))
          )}
          <p className="empty" style={{ paddingTop: 8 }}>
            누적 사람 수정 {totalCorrected}건 — 반복 수정이 역할 AI 메모리로 학습됩니다.
          </p>
        </div>
      </div>

      <div className="sh" style={{ marginTop: 6 }}>
        <h2>Autopilot 관제</h2>
        <span className="n">{autopilotEnabled ? "ON" : "OFF"}</span>
        <span className="flow">정책·킬스위치·뒤집힘율</span>
      </div>
      <div className="ck-cols">
        <div className="pnl">
          <div className="ph">
            <b>도메인×유형 정책</b>
            <span className="co mlbl">모드·임계</span>
          </div>
          {policies.length === 0 ? (
            <p className="empty">등록된 자율운영 정책이 없습니다 — 전부 관찰 상태.</p>
          ) : (
            policies.map((p, i) => (
              <div className="kv" key={`${p.domain}-${p.decisionType}-${i}`}>
                <span className="k">
                  {p.domain} · {p.decisionType}
                </span>
                <span className="v">
                  {MODE_KO[p.mode] ?? p.mode} · 임계 {Math.round(p.minAutonomy * 100)}% · 표본{" "}
                  {p.minSamples}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="pnl">
          <div className="ph">
            <b>킬스위치</b>
            <span className="co mlbl">즉시 전체 정지</span>
          </div>
          <AutopilotKillSwitch enabled={autopilotEnabled} />
          <p className="empty" style={{ paddingTop: 10 }}>
            최근 {REVERSAL_WINDOW_DAYS}일 뒤집힘율 <b>{reversal.rate}%</b> ({reversal.reversed}/
            {reversal.total}건)
          </p>
        </div>
      </div>

      <div className="sh" style={{ marginTop: 6 }}>
        <h2>LLM 계측</h2>
        <span className="n">{llmObservability.llmCalls}</span>
        <span className="flow">호출량·지연·실패율</span>
      </div>
      <div className="pnl">
        <div className="ph">
          <b>LLM 호출 계측</b>
          <span className="co mlbl">실측</span>
        </div>
        {llmObservability.llmCalls === 0 ? (
          <p className="empty">아직 계측된 호출 없음</p>
        ) : (
          <>
            <div className="kv">
              <span className="k">최근 24시간 호출</span>
              <span className="v">{llmObservability.last24h}건</span>
            </div>
            <div className="kv">
              <span className="k">최근 7일 호출</span>
              <span className="v">{llmObservability.last7d}건</span>
            </div>
            <div className="kv">
              <span className="k">지연 p50 / p95</span>
              <span className="v">
                {llmObservability.latencyP50}ms / {llmObservability.latencyP95}ms
              </span>
            </div>
            <div className="kv">
              <span className="k">실패율</span>
              <span className="v">{Math.round(llmObservability.failureRate * 100)}%</span>
            </div>
          </>
        )}
      </div>

      <div className="pnl">
        <div className="ph">
          <b>최근 자동 결정</b>
          <span className="co mlbl">최근 {recentAutoDecisions.length}건</span>
        </div>
        {recentAutoDecisions.length === 0 ? (
          <p className="empty">아직 자동 승인된 결정이 없습니다.</p>
        ) : (
          recentAutoDecisions.map((d) => (
            <div className="learn" key={d.id}>
              <div className="ic">{d.outcome === "rejected" ? "↩" : "⚡"}</div>
              <div className="x">
                <b>{d.caseRef ?? d.id}</b>
                <span>
                  {d.outcome ?? "approved"} · {new Date(d.createdAt).toLocaleString("ko-KR")}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
