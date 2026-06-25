export default function ColorAgentsPage() {
  const colors = [
    ["Blue", "Technical Direction", "기술 방향 / 구현 / 아키텍처"],
    ["Red", "Risk & Safety", "보안 / 리스크 / 회귀 / 승인 우회"],
    ["Orange", "Product & Business Value", "고객 가치 / 매출 / ROI"],
    ["Gray", "Documentation & Evidence", "문서 / 결정 기록 / 근거"],
    ["Teal", "UX & Visibility", "UI/UX / 대시보드 / 가시성"],
  ];

  return (
    <main style={{ padding: 24 }}>
      <h1>Hermes Color Agent Organization</h1>
      <p>
        Color Agents are review perspectives and Kanban handoff owners.
        They do not replace business personas.
      </p>
      <section>
        {colors.map(([color, name, desc]) => (
          <article key={color} style={{ border: "1px solid #ddd", padding: 16, marginBottom: 12 }}>
            <h2>{color} — {name}</h2>
            <p>{desc}</p>
            <p>Status: pending / passed / failed / not required</p>
          </article>
        ))}
      </section>
    </main>
  );
}
