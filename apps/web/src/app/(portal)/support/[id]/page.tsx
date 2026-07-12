export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@sangfor/db";
import { RelatedKnowledgePanel } from "@/components/support/related-knowledge-panel";

export default async function SupportCaseDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supportCase = await prisma.supportCase.findUnique({
    where: { id },
    include: { customer: { select: { name: true } }, vendorEscalations: true },
  });
  if (!supportCase) notFound();

  const product = supportCase.vendorEscalations[0]?.vendor;

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">기술지원 · 케이스 상세</div>
          <h1>{supportCase.subject}</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            {supportCase.customer?.name ?? "고객 미지정"} · 담당 엔지니어 AI
          </div>
        </div>
        <span className={`dur ${supportCase.severity === "high" ? "d2" : ""}`}>
          {supportCase.severity}
        </span>
      </div>

      <div className="ck-cols">
        <div>
          <div className="pnl">
            <div className="ph">
              <b>케이스 정보</b>
              <span className="co mlbl">{supportCase.status}</span>
            </div>
            <div className="kv">
              <span className="k">고객사</span>
              <span className="v">{supportCase.customer?.name ?? "미지정"}</span>
            </div>
            <div className="kv">
              <span className="k">심각도</span>
              <span className="v">{supportCase.severity}</span>
            </div>
            <div className="kv">
              <span className="k">상태</span>
              <span className="v">{supportCase.status}</span>
            </div>
            <div className="kv">
              <span className="k">SLA</span>
              <span className="v">
                {supportCase.slaDeadline
                  ? new Date(supportCase.slaDeadline).toLocaleDateString("ko-KR")
                  : "—"}
              </span>
            </div>
          </div>

          <div className="pnl">
            <div className="ph">
              <b>벤더 에스컬레이션</b>
              <span className="co mlbl">{supportCase.vendorEscalations.length}</span>
            </div>
            {supportCase.vendorEscalations.length === 0 ? (
              <p className="empty">등록된 벤더 에스컬레이션이 없습니다.</p>
            ) : (
              supportCase.vendorEscalations.map((esc) => (
                <div className="scard" key={esc.id}>
                  <b>{esc.vendor}</b>
                  <span className="pt">{esc.reason}</span>
                  <div className="bt">
                    <span className="dur">{esc.status}</span>
                  </div>
                  {esc.resolution ? <span className="dt">해결: {esc.resolution}</span> : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <RelatedKnowledgePanel caseSubject={supportCase.subject} product={product} />
          <Link href="/support" className="go" style={{ display: "inline-block", marginTop: 4 }}>
            ← 기술지원 목록
          </Link>
        </div>
      </div>
    </div>
  );
}
