export const dynamic = "force-dynamic";

import { prisma } from "@sangfor/db";
import { SlipActions } from "@/components/cockpit/slip-actions";
import { roleFor, TYPE_KO, wfFor, WF_KO, domainOf, revalOf } from "@/lib/cockpit";

export default async function InboxPage() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [items, total, todayCount, avg] = await Promise.all([
    prisma.mailDerivedCandidate.findMany({
      where: { status: "proposed" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.mailDerivedCandidate.count({ where: { status: "proposed" } }),
    prisma.mailDerivedCandidate.count({
      where: { status: "proposed", createdAt: { gte: startOfToday } },
    }),
    prisma.mailDerivedCandidate.aggregate({
      where: { status: "proposed" },
      _avg: { confidence: true },
    }),
  ]);

  const byType = items.reduce<Record<string, number>>((a, c) => {
    a[c.candidateType] = (a[c.candidateType] ?? 0) + 1;
    return a;
  }, {});
  const avgConf = Math.round(avg._avg.confidence ?? 0);

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">관제 · 앞문</div>
          <h1>인입함</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            메일 → 마케팅 AI 분류 → 워크플로 배정
          </div>
        </div>
        <div className="big-r">
          자동 분류 신뢰도<br />
          <b>{avgConf}%</b>
        </div>
      </div>

      <div className="ck-cols">
        <div>
          <div className="sh">
            <h2>미분류 인입</h2>
            <span className="n">{total}</span>
            <span className="flow">추정 → 확인 → 배정</span>
          </div>

          {items.length === 0 ? (
            <p className="empty">새 인입이 없습니다.</p>
          ) : (
            items.map((c) => {
              const role = roleFor(c.candidateType);
              const wf = wfFor(c.candidateType, c.title);
              const reval = revalOf(c.metadata);
              return (
                <div className="itm" key={c.id}>
                  <div className="t">
                    <span className="srcb mail">메일</span>
                    <div className="x">
                      <b>{c.title}</b>
                      <div className="from">
                        {c.sourceSender ?? "메일 파생"}
                        {c.sourceReceivedAt
                          ? ` · ${new Date(c.sourceReceivedAt).toLocaleDateString("ko-KR")}`
                          : ""}
                      </div>
                    </div>
                  </div>
                  {c.summary ? <div className="prev">{c.summary}</div> : null}
                  <div className="guess">
                    <span className="gl">AI 추정</span>
                    <div className="tags">
                      <span className={`gtag wf ${wf === "n" ? "" : wf}`}>{WF_KO[wf]}</span>
                      <span className="gtag cu">{domainOf(c.sourceSender)}</span>
                      <span className="gtag ro">→ {role.label}</span>
                    </div>
                    <span className="cf">
                      {reval === "approve_candidate"
                        ? "재검증 통과"
                        : `신뢰 ${c.confidence}%`}
                    </span>
                  </div>
                  <SlipActions candidateId={c.id} detailHref={`/approvals/mail-candidates/${c.id}`} />
                </div>
              );
            })
          )}
        </div>

        <div>
          <div className="pnl">
            <div className="ph">
              <b>오늘 인입</b>
              <span className="co mlbl">유형별</span>
            </div>
            <div className="bign">
              <div className="v">{todayCount}</div>
              <div className="k">오늘 · 전체 대기 {total}</div>
            </div>
            {Object.entries(byType).map(([t, n]) => (
              <div className="srcstat" key={t}>
                <div className="l">
                  <span className="srcb mail">메일</span> {TYPE_KO[t] ?? t}
                </div>
                <div className="val">{n}</div>
              </div>
            ))}
          </div>
          <div className="pnl">
            <div className="ph">
              <b>분류 성능</b>
              <span className="co mlbl">마케팅 AI</span>
            </div>
            <div className="srcstat">
              <div className="l">대기 후보</div>
              <div className="val">{total}</div>
            </div>
            <div className="srcstat">
              <div className="l">평균 신뢰도</div>
              <div className="val">{avgConf}%</div>
            </div>
            <div className="srcstat">
              <div className="l">오늘 인입</div>
              <div className="val">{todayCount}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
