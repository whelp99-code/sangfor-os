export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { getCustomerDetail } from "@sangfor/business";
import { prisma } from "@sangfor/db";
import { daysUntil, won } from "@/lib/cockpit";
import { EntityEditSheet } from "@/components/common/entity-edit-sheet";
import { CreateContactForm } from "@/components/customers/create-contact-form";
import { DeleteEntityButton } from "@/components/common/delete-entity-button";

const STAGE_KO: Record<string, string> = {
  LEAD: "리드", QUALIFIED: "검증", PROPOSAL: "제안", NEGOTIATION: "협상",
  POC: "PoC", WON: "수주", LOST: "이탈",
};

const RENEWAL_STATUS_KO: Record<string, string> = {
  pending: "대상 감지",
  notified: "안내 발송",
  quote_requested: "견적 요청",
  vendor_quote: "총판 견적",
  delivered: "고객 전달",
  po: "PO·구매",
  renewed: "갱신 완료",
  lost: "갱신 실패",
};

const ACTIVITY_TYPE_KO: Record<string, string> = {
  created: "등록",
  updated: "수정",
  contact_added: "연락처 등록",
  partner_linked: "파트너 연결",
};

export default async function CustomerHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomerDetail(id).catch(() => null);
  if (!customer) notFound();

  const [assets, renewals, supportCases] = await Promise.all([
    prisma.customerAsset.findMany({
      where: { customerId: id },
      orderBy: { warrantyEnd: "asc" },
    }),
    prisma.renewalOpportunity.findMany({
      where: { customerId: id },
      orderBy: { expiresAt: "asc" },
    }),
    prisma.supportCase.findMany({ where: { customerId: id } }),
  ]);

  const opps = customer.opportunities ?? [];
  const activeOpps = opps.filter((o) => o.stage !== "WON" && o.stage !== "LOST");
  const wonOpps = opps.filter((o) => o.stage === "WON");
  const totalValue = wonOpps.reduce((s, o) => s + Number(o.amount ?? 0), 0);
  const nextRenewalD = renewals
    .map((r) => daysUntil(r.expiresAt))
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  // 관계 타임라인: 영업기회(n) + 리뉴얼(r), 날짜 내림차순
  type Ev = { date: Date; kind: "n" | "r"; title: string; amount?: number; sub: string };
  const events: Ev[] = [
    ...opps.map((o) => ({
      date: new Date(o.createdAt),
      kind: "n" as const,
      title: o.title,
      amount: Number(o.amount ?? 0),
      sub: `신규영업 · ${STAGE_KO[o.stage] ?? o.stage}`,
    })),
    ...renewals.map((r) => ({
      date: new Date(r.createdAt),
      kind: "r" as const,
      title: `${r.renewalType ?? "갱신"} 리뉴얼`,
      amount: Number(r.amount ?? 0),
      sub: `리뉴얼 · ${RENEWAL_STATUS_KO[r.status] ?? r.status}`,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  // 연도 헤더 삽입
  const rows: (Ev | { year: number })[] = [];
  let lastYear = 0;
  for (const e of events) {
    const y = e.date.getFullYear();
    if (y !== lastYear) {
      rows.push({ year: y });
      lastYear = y;
    }
    rows.push(e);
  }

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">고객사 · 허브</div>
          <h1>{customer.name}</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            {customer.industry ?? "업종 미지정"} · 세그먼트 {customer.segment ?? "—"} · 담당 영업 AI
          </div>
          <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
            <EntityEditSheet
              title="고객사 수정"
              endpoint={`/api/customers/${customer.id}`}
              fields={[
                { name: "name", label: "이름" },
                { name: "domain", label: "도메인" },
                { name: "industry", label: "업종" },
                { name: "status", label: "상태", type: "select", options: [
                  { value: "active", label: "활성" },
                  { value: "inactive", label: "비활성" },
                  { value: "archived", label: "보관" },
                ]},
                { name: "notes", label: "메모" },
              ]}
              initial={{
                name: customer.name,
                domain: customer.domain ?? "",
                industry: customer.industry ?? "",
                status: customer.status ?? "active",
                notes: customer.notes ?? "",
              }}
            />
          </div>
        </div>
        <div className="big-r">
          누적 수주액
          <br />
          <b>{won(totalValue)}</b>
        </div>
      </div>

      <div className="relbar">
        <div className="rel"><div className="v">{activeOpps.length}</div><div className="k">진행 딜</div></div>
        <div className="rel"><div className="v">{wonOpps.length}</div><div className="k">누적 계약</div></div>
        <div className="rel"><div className={`v ${nextRenewalD !== undefined ? "o" : ""}`}>{nextRenewalD !== undefined ? `D-${nextRenewalD}` : "—"}</div><div className="k">다음 리뉴얼</div></div>
        <div className="rel"><div className="v">{supportCases.length}</div><div className="k">지원 이력</div></div>
        <div className="rel"><div className="v">{customer.contacts?.length ?? 0}</div><div className="k">연락처</div></div>
      </div>

      <div className="ck-cols">
        <div>
          <div className="sh">
            <h2>관계 타임라인</h2>
            <span className="flow">신규 · 리뉴얼 통합</span>
          </div>
          {events.length === 0 ? (
            <p className="empty">거래 이력이 없습니다.</p>
          ) : (
            <div className="spine">
              {rows.map((r, i) =>
                "year" in r ? (
                  <div className="ev head" key={`y${r.year}`}>
                    <span className="yr">{r.year}</span>
                  </div>
                ) : (
                  <div className={`ev ${r.kind}`} key={i}>
                    <div className="dt">
                      {r.date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                    </div>
                    <div className="l1">
                      <b>{r.title}</b>
                      {r.amount ? <span className="amt">{won(r.amount)}</span> : null}
                    </div>
                    <div className="l2">
                      <span className={`wf ${r.kind}`}>
                        {r.kind === "n" ? "신규영업" : "리뉴얼"}
                      </span>
                      <span className="who">{r.sub}</span>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div>
          <div className="pnl mini" style={{ marginBottom: 16 }}>
            <div className="ph">
              <b>보유 솔루션</b>
              <span className="co mlbl">리뉴얼 트리거</span>
            </div>
            {assets.length === 0 ? (
              <p className="empty">등록된 보유 솔루션이 없습니다.</p>
            ) : (
              assets.map((a) => {
                const d = daysUntil(a.warrantyEnd);
                return (
                  <div className="asset" key={a.id}>
                    <div className="nm">
                      {a.name}
                      <small>{a.assetType ?? "솔루션"}</small>
                    </div>
                    <div className={`ex ${d !== null && d <= 90 ? "soon" : "ok"}`}>
                      {a.warrantyEnd
                        ? d !== null && d <= 90
                          ? `D-${d}`
                          : new Date(a.warrantyEnd).toLocaleDateString("ko-KR", {
                              year: "numeric",
                              month: "2-digit",
                            })
                        : "—"}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pnl mini" style={{ marginBottom: 16 }}>
            <div className="ph">
              <b>연락처</b>
              <span className="co mlbl">{customer.contacts?.length ?? 0}</span>
            </div>
            {(customer.contacts ?? []).length === 0 ? (
              <p className="empty">연락처가 없습니다.</p>
            ) : (
              (customer.contacts ?? []).slice(0, 5).map((c) => (
                <div className="kv items-center" key={c.id}>
                  <span className="k">{c.name}</span>
                  <span className="v flex items-center gap-2">
                    {c.role ?? c.email ?? ""}
                    <EntityEditSheet
                      title="연락처 수정"
                      endpoint={`/api/contacts/${c.id}`}
                      fields={[
                        { name: "name", label: "이름" },
                        { name: "email", label: "이메일" },
                        { name: "phone", label: "전화" },
                        { name: "role", label: "직책" },
                      ]}
                      initial={{ name: c.name, email: c.email ?? "", phone: c.phone ?? "", role: c.role ?? "" }}
                    />
                    <DeleteEntityButton endpoint={`/api/contacts/${c.id}`} label="보관" />
                  </span>
                </div>
              ))
            )}
            <div style={{ marginTop: 8 }}>
              <CreateContactForm customerId={customer.id} />
            </div>
          </div>

          <div className="pnl">
            <div className="ph">
              <b>AI 활동 이력</b>
              <span className="co mlbl">이 고객</span>
            </div>
            {(customer.activityLogs ?? []).length === 0 ? (
              <p className="empty">기록된 활동이 없습니다.</p>
            ) : (
              (customer.activityLogs ?? []).slice(0, 4).map((a) => (
                <div className="aiact" key={a.id}>
                  <div className="rolech sa">SA</div>
                  <div className="x">
                    <b>{a.summary}</b>
                    <span>{ACTIVITY_TYPE_KO[a.activityType ?? ""] ?? "활동"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <Link href="/customers" className="go" style={{ display: "inline-block", marginTop: 4 }}>
            ← 고객 목록
          </Link>
        </div>
      </div>
    </div>
  );
}
