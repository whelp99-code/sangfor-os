export default function HomePage() {
  return (
    <main className="p-6 space-y-6">
      <section>
        <h1 className="text-2xl font-bold">Agentic Company OS</h1>
        <p>SANGFOR Partner Operations Dashboard</p>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <h2 className="font-semibold">Revenue Pipeline</h2>
          <p>제품군별 예상 매출과 weighted forecast</p>
        </div>
        <div className="rounded border p-4">
          <h2 className="font-semibold">Approval Queue</h2>
          <p>내 승인 대기, 자동 검증 실패, stale approval</p>
        </div>
        <div className="rounded border p-4">
          <h2 className="font-semibold">Renewal Forecast</h2>
          <p>90일 내 갱신 예정 subscription</p>
        </div>
      </section>

      <section className="rounded border p-4">
        <h2 className="font-semibold">Deal Pipeline Board</h2>
        <div className="grid grid-cols-5 gap-2 text-sm">
          {["Lead", "Discovery", "Solution Fit", "Quote", "PoC"].map((stage) => (
            <div key={stage} className="rounded border p-3">
              <h3 className="font-medium">{stage}</h3>
              <p className="text-gray-500">Cards will be loaded from API.</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
