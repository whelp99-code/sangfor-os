export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { withRlsTransaction } from "@sangfor/db";
import { RelatedKnowledgePanel } from "@/components/support/related-knowledge-panel";
import { SupportSlaClock } from "@/components/support/support-sla-clock";
import { SupportCaseActions } from "@/components/support/support-case-actions";
import { SupportReplyDraftPanel } from "@/components/support/support-reply-draft-panel";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { resolveBusinessCapabilityContext } from "@/lib/auth/authorization";

export default async function SupportCaseDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(new Request(
    `http://sangfor.local/support/${encodeURIComponent(id)}`,
    { headers: { cookie: `session=${encodeURIComponent(token)}` } },
  ));
  if (!session.ok) redirect("/login");
  // The page and its preview API share the same current support.read capability.
  // No case data or knowledge panel is rendered before this scope check succeeds.
  const access = await resolveBusinessCapabilityContext({
    userId: session.userId, sessionId: null, tenantId: session.tenantId,
    companyId: session.companyId, projectId: session.projectId, product: "portal",
  }, "apps/web/src/app/api/support/[id]/reply-draft/route.ts").catch(() => null);
  if (!access?.ok) notFound();
  const context = access.context;
  const supportCase = await withRlsTransaction(context, (tx) => tx.supportCase.findFirst({
    where: { id, customer: { projectId: context.projectId, archivedAt: null } },
    include: { customer: { select: { name: true } }, vendorEscalations: true },
  }));
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
            <div className="mt-4 space-y-3">
              <SupportSlaClock severity={supportCase.severity} />
              <SupportCaseActions
                supportCaseId={supportCase.id}
                status={supportCase.status}
                revision={supportCase.revision}
              />
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
          <SupportReplyDraftPanel key={supportCase.id} supportCaseId={supportCase.id} />
          <RelatedKnowledgePanel caseSubject={supportCase.subject} product={product} />
          <Link href="/support" className="go" style={{ display: "inline-block", marginTop: 4 }}>
            ← 기술지원 목록
          </Link>
        </div>
      </div>
    </div>
  );
}
