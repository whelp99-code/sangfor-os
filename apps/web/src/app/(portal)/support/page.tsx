export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@sangfor/db";

const STAGES = [
  { key: "received", nm: "요청 접수", sub: "파트너사" },
  { key: "scheduling", nm: "일정 조율", sub: "고객사" },
  { key: "visiting", nm: "방문·확인", sub: "요청사항" },
  { key: "confirmed", nm: "일정 확정", sub: "파트너 논의" },
  { key: "supporting", nm: "설치 지원", sub: "1일 / 2일" },
];
// 자유형 status → 5단계 컬럼
function stageOf(status: string): number {
  const s = status.toLowerCase();
  if (/(schedul|일정조율)/.test(s)) return 1;
  if (/(visit|onsite|방문)/.test(s)) return 2;
  if (/(confirm|확정)/.test(s)) return 3;
  if (/(support|install|resolv|설치|완료|done)/.test(s)) return 4;
  return 0; // open/new/기타 → 요청 접수
}

export default async function SupportPage() {
  const cases = await prisma.supportCase.findMany({
    include: { customer: { select: { name: true } }, vendorEscalations: true },
    orderBy: { id: "desc" },
    take: 60,
  });

  const columns: (typeof cases)[] = [[], [], [], [], []];
  for (const c of cases) columns[stageOf(c.status)].push(c);

  const active = cases.filter((c) => !/(resolv|closed|done|완료)/i.test(c.status)).length;

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">워크플로 · 파트너 트리거</div>
          <h1>기술지원</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            파트너사 프로젝트·제품 설치지원 · 진행 {active} · 담당 엔지니어 AI
          </div>
        </div>
        <div className="big-r">
          전체 케이스
          <br />
          <b>{cases.length}</b>
        </div>
      </div>

      <div className="flow-note">
        {STAGES.map((s) => (
          <div className="fn" key={s.key}>
            <b>{s.nm}</b>
            {s.sub}
          </div>
        ))}
      </div>

      {cases.length === 0 ? (
        <p className="empty">
          접수된 기술지원 케이스가 없습니다. 파트너사 지원요청이 인입되면 여기에
          단계별로 나타납니다.
        </p>
      ) : (
        <div className="board">
          {STAGES.map((s, i) => (
            <div className="col" key={s.key}>
              <div className="ch2">
                <b>{s.nm}</b>
                <span className="c">{columns[i].length}</span>
              </div>
              {columns[i].length === 0 ? (
                <div className="empty" style={{ textAlign: "center", paddingTop: 24 }}>
                  —
                </div>
              ) : (
                columns[i].map((c) => (
                  <Link className="scard" href={`/support/${c.id}`} key={c.id} style={{ display: "block" }}>
                    <b>{c.subject}</b>
                    <span className="pt">{c.customer?.name ?? "고객 미지정"}</span>
                    <div className="bt">
                      <span className={`dur ${c.severity === "high" ? "d2" : ""}`}>
                        {c.severity}
                      </span>
                      <span className="en">엔지니어 AI</span>
                    </div>
                    {c.slaDeadline ? (
                      <span className="dt">
                        SLA {new Date(c.slaDeadline).toLocaleDateString("ko-KR")}
                      </span>
                    ) : null}
                  </Link>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
