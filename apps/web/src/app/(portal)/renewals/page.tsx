export const dynamic = "force-dynamic";

import { prisma } from "@sangfor/db";
import { daysUntil, won } from "@/lib/cockpit";

const STAGES = [
  { key: "pending", n: "대상 감지\nD-90" },
  { key: "notified", n: "안내메일\n발송" },
  { key: "quote_requested", n: "고객\n견적요청" },
  { key: "vendor_quote", n: "총판\n견적" },
  { key: "delivered", n: "고객 전달\n마진 20%" },
  { key: "po", n: "PO·구매" },
  { key: "renewed", n: "라이센스\n전달" },
];

export default async function RenewalsPage() {
  const [renewals, assets, byStatus] = await Promise.all([
    prisma.renewalOpportunity.findMany({
      where: { status: { notIn: ["renewed", "lost"] } },
      include: { customer: { select: { name: true } } },
      orderBy: { expiresAt: "asc" },
      take: 40,
    }),
    prisma.customerAsset.findMany({
      where: { status: "active", warrantyEnd: { not: null } },
      include: { customer: { select: { name: true } } },
      orderBy: { warrantyEnd: "asc" },
      take: 40,
    }),
    prisma.renewalOpportunity.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  // 만료 레이더: 다가오는 6개월 버킷 (renewal.expiresAt + asset.warrantyEnd)
  const now = new Date();
  const months: { label: string; d90: boolean; items: { name: string; d: number | null }[] }[] =
    Array.from({ length: 6 }, (_, i) => {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return {
        label: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`,
        d90: i <= 2,
        items: [],
      };
    });
  const bucketFor = (date: Date | null) => {
    if (!date) return -1;
    const d = new Date(date);
    return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
  };
  for (const r of renewals) {
    const b = bucketFor(r.expiresAt);
    if (b >= 0 && b < 6)
      months[b].items.push({ name: r.customer?.name ?? "고객", d: daysUntil(r.expiresAt) });
  }
  for (const a of assets) {
    const b = bucketFor(a.warrantyEnd);
    if (b >= 0 && b < 6)
      months[b].items.push({
        name: `${a.customer?.name ?? "고객"} · ${a.name}`,
        d: daysUntil(a.warrantyEnd),
      });
  }

  const inQuarter = renewals
    .map((r) => ({ ...r, d: daysUntil(r.expiresAt) }))
    .filter((r) => r.d !== null && r.d <= 120);
  const quarterAmount = inQuarter.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const countFor = (k: string) =>
    byStatus.find((s) => s.status === k)?._count._all ?? 0;
  const totalActive = renewals.length;

  const cards = inQuarter.slice(0, 8);

  return (
    <div className="cockpit ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">워크플로 · 시간 트리거</div>
          <h1>리뉴얼</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            보유 솔루션 만료 기반 · 진행 {totalActive} · 만료 D-90 감지
          </div>
        </div>
        <div className="big-r">
          이번 분기 갱신
          <br />
          <b>{won(quarterAmount)}</b>
        </div>
      </div>

      <section className="radar">
        <div className="rh">
          <span className="mlbl" style={{ color: "var(--ck-muted)" }}>
            만료 레이더 · 다가오는 갱신
          </span>
          <span className="win">D-90 감지창</span>
        </div>
        <div className="months">
          {months.map((m) => (
            <div className={`mo ${m.d90 ? "d90" : ""}`} key={m.label}>
              <span className="ml">{m.label}</span>
              {m.items.length === 0 ? null : (
                m.items.slice(0, 3).map((it, i) => (
                  <div
                    className={`mk-r ${
                      it.d !== null && it.d <= 30 ? "u" : it.d !== null && it.d <= 90 ? "o" : "g"
                    }`}
                    key={i}
                  >
                    {it.name}
                    <small>{it.d !== null ? `D-${it.d}` : ""}</small>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="flow-row">
        {STAGES.map((s, i) => (
          <div className={`stg ${i <= 2 ? "hot" : ""}`} key={s.key}>
            <div className="c">{countFor(s.key) || "—"}</div>
            <div className="n" style={{ whiteSpace: "pre-line" }}>
              {s.n}
            </div>
          </div>
        ))}
      </div>

      <div className="sh">
        <h2>진행 중 갱신</h2>
        <span className="n">{totalActive}</span>
        <span className="flow">D-day 순 · 영업 AI 담당</span>
      </div>
      {cards.length === 0 ? (
        <p className="empty">
          만료 D-120 이내 갱신 대상이 없습니다. 고객 보유 솔루션(CustomerAsset)이
          등록되면 만료일 기준으로 자동 감지됩니다.
        </p>
      ) : (
        cards.map((r) => {
          const cls = (r.d ?? 0) <= 14 ? "u" : (r.d ?? 0) <= 60 ? "s" : "o";
          return (
            <div className="rcard" key={r.id}>
              <div className={`dd ${cls}`}>
                {(r.d ?? 0) <= 0 ? "만료" : `D-${r.d}`}
              </div>
              <div className="x">
                <b>
                  {r.customer?.name ?? "고객"} · {r.renewalType ?? "갱신"}
                </b>
                <span>영업 AI · 상태 {r.status}</span>
              </div>
              <span className="stg-t">{r.status}</span>
              <div className="amt">{won(Number(r.amount ?? 0))}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
