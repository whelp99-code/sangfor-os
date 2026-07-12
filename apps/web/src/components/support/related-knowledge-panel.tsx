import { engineerConsole } from "@sangfor/infra";

export async function RelatedKnowledgePanel({
  caseSubject,
  product,
}: {
  caseSubject: string;
  product?: string;
}) {
  let chunks: { id?: string; title?: string; section?: string; text?: string; source?: string }[] = [];
  let failed = false;
  try {
    const result = await engineerConsole.ragSearch({ query: caseSubject, product, limit: 5 });
    chunks = (result.results ?? []).slice(0, 3).map((hit) => ({
      id: hit.id,
      title: typeof hit.title === "string" ? hit.title : undefined,
      section: typeof hit.section === "string" ? hit.section : undefined,
      text: hit.text,
      source: hit.source,
    }));
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="pnl">
        <div className="ph">
          <b>관련 지식</b>
          <span className="co mlbl">엔지니어 RAG</span>
        </div>
        <span style={{ fontSize: 12.5 }}>
          엔지니어 지식 서비스에 연결하지 못했습니다. 서비스 상태를 확인해 주세요.
        </span>
      </div>
    );
  }
  if (chunks.length === 0) return null;

  return (
    <div className="pnl">
      <div className="ph">
        <b>관련 지식</b>
        <span className="co mlbl">엔지니어 RAG</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {chunks.map((chunk, i) => (
          <li className="kv" key={chunk.id ?? i} style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
            <b>
              {chunk.title ?? "제목 없음"}
              {chunk.section ? ` · ${chunk.section}` : ""}
            </b>
            <span style={{ fontSize: 12.5 }}>{(chunk.text ?? "").slice(0, 200)}</span>
            {chunk.source ? <span className="mlbl">{chunk.source}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
