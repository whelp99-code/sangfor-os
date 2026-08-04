import { KnowledgeSearch } from "@/components/knowledge/knowledge-search";

export default function KnowledgeSearchPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">지식 검색</h1>
        <p className="text-sm text-muted-foreground">
          포털 지식베이스 검색 (인용 포함). 엔지니어 콘솔 RAG와 분리된 경로입니다.
        </p>
      </div>
      <KnowledgeSearch />
    </div>
  );
}
