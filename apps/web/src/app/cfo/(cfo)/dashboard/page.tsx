export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@sangfor/db";

function won(n: number): string {
  const m = n / 1_000_000;
  if (Math.abs(m) >= 1) return `₩${m.toFixed(1)}M`;
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

export default async function CfoDashboardPage() {
  const [invoices, cashflows] = await Promise.all([
    prisma.invoice.findMany({ orderBy: { issueDate: "desc" }, take: 200 }),
    prisma.cashflow.findMany({ orderBy: { date: "desc" }, take: 400 }),
  ]);

  const receivable = invoices.filter((i) => i.depositStatus === "미수");
  const partial = invoices.filter((i) => i.depositStatus === "부분");
  const settled = invoices.filter((i) => i.depositStatus === "완료");
  const receivableSum =
    receivable.reduce((s, i) => s + Number(i.total ?? 0), 0) +
    partial.reduce((s, i) => s + Number(i.total ?? 0), 0);
  const settledSum = settled.reduce((s, i) => s + Number(i.total ?? 0), 0);

  // 월별 순증(cashChange)
  const byMonth = new Map<string, number>();
  for (const c of cashflows) {
    if (!c.date) continue;
    const k = new Date(c.date).toISOString().slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + Number(c.cashChange ?? 0));
  }
  const months = [...byMonth.entries()].sort().slice(-6);
  const maxAbs = Math.max(1, ...months.map(([, v]) => Math.abs(v)));
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const thisMonthNet = byMonth.get(thisMonthKey) ?? 0;
  const cashBalance =
    cashflows.find((c) => c.balanceAfter != null)?.balanceAfter ?? null;

  return (
    <div className="cockpit ck-flush ck-grain">
      <div className="ck-hdr">
        <div>
          <div className="mlbl">기반 · CFO AI 도메인</div>
          <h1>재무</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ck-muted)", marginTop: 5 }}>
            현금흐름·인보이스·미수금 · 로컬 집계 · 담당 CFO AI
          </div>
        </div>
        <div className="big-r">
          완료 매출
          <br />
          <b>{won(settledSum)}</b>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k">이번 달 순증</div>
          <div className="v" style={{ color: thisMonthNet < 0 ? "var(--ck-red-deep)" : undefined }}>
            {won(thisMonthNet)}
          </div>
          <div className="d">현금흐름 {thisMonthKey}</div>
        </div>
        <div className="kpi">
          <div className="k">미수금</div>
          <div className="v">{won(receivableSum)}</div>
          <div className="d">{receivable.length + partial.length}건 · 미수·부분</div>
        </div>
        <div className="kpi">
          <div className="k">현금 잔액</div>
          <div className="v">{cashBalance != null ? won(Number(cashBalance)) : "—"}</div>
          <div className="d">최근 잔액 스냅샷</div>
        </div>
        <div className="kpi">
          <div className="k">인보이스</div>
          <div className="v">{invoices.length}</div>
          <div className="d">완료 {settled.length} · 미수 {receivable.length}</div>
        </div>
      </div>

      <div className="spine-row">
        <div className="sn"><div className="c">{invoices.length}</div><div className="a">발행</div><div className="n">인보이스</div></div>
        <div className="sn"><div className="c">{settled.length}</div><div className="a">{won(settledSum)}</div><div className="n">입금 완료</div></div>
        <div className="sn"><div className="c">{receivable.length}</div><div className="a">{won(receivable.reduce((s, i) => s + Number(i.total ?? 0), 0))}</div><div className="n">미수</div></div>
        <div className="sn"><div className="c">{cashflows.length}</div><div className="a">현금 이벤트</div><div className="n">현금흐름</div></div>
        <div className="sn"><div className="c">—</div><div className="a">외부 연동</div><div className="n">세금계산서</div></div>
      </div>

      <div className="ck-cols">
        <div className="pnl">
          <div className="ph">
            <b>현금흐름</b>
            <span className="co mlbl">최근 6개월 · 순증</span>
          </div>
          {months.length === 0 ? (
            <p className="empty">현금흐름 데이터가 없습니다.</p>
          ) : (
            months.map(([k, v]) => (
              <div className="cfrow" key={k}>
                <span className="mo">{k}</span>
                <div className="barw">
                  <i
                    className={v < 0 ? "neg" : ""}
                    style={{ width: `${Math.round((Math.abs(v) / maxAbs) * 100)}%` }}
                  />
                </div>
                <span className="amt" style={{ color: v < 0 ? "var(--ck-red-deep)" : "var(--ck-teal-deep)" }}>
                  {v < 0 ? "-" : "+"}
                  {won(Math.abs(v)).replace("₩", "")}
                </span>
              </div>
            ))
          )}
        </div>

        <div>
          <div className="pnl" style={{ marginBottom: 16 }}>
            <div className="ph">
              <b>미수금</b>
              <span className="co mlbl">입금 대기</span>
            </div>
            {receivable.length === 0 && partial.length === 0 ? (
              <p className="empty">미수금이 없습니다.</p>
            ) : (
              [...receivable, ...partial].slice(0, 5).map((i) => (
                <div className="tx" key={i.id}>
                  <span className={`std ${i.depositStatus === "미수" ? "rd" : "wa"}`} />
                  <div className="x">
                    <b>{i.buyer ?? "거래처"}</b>
                    <span>
                      {i.depositStatus} ·{" "}
                      {i.issueDate ? new Date(i.issueDate).toLocaleDateString("ko-KR") : ""}
                    </span>
                  </div>
                  <span className="a">{won(Number(i.total ?? 0))}</span>
                </div>
              ))
            )}
          </div>
          <div className="pnl">
            <div className="ph">
              <b>CFO AI 활동</b>
              <span className="co mlbl">연동</span>
            </div>
            <div className="tx">
              <span className="std ok" />
              <div className="x">
                <b>미수금 리마인더 후보</b>
                <span>미수 {receivable.length}건 · 초안 대기</span>
              </div>
            </div>
            <p className="empty" style={{ paddingTop: 8 }}>
              세금계산서·견적·마진 게이트는 외부 CFO 서비스 연동 시 채워집니다.
            </p>
            <Link href="/cfo/cashflows" className="go" style={{ display: "inline-block", marginTop: 8 }}>
              현금흐름 상세 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
