export const dynamic = "force-dynamic";

import Link from "next/link";
import { listKnowledgeDocuments } from "@sangfor/business/knowledge-search";

import { CreateKnowledgeForm } from "@/components/knowledge/create-knowledge-form";
import { KnowledgeSearch } from "@/components/knowledge/knowledge-search";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function KnowledgePage() {
  const documents = await listKnowledgeDocuments();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">지식베이스</h1>
        <p className="text-muted-foreground">인용·컨텍스트 팩을 포함한 조각 단위 검색.</p>
      </div>
      <KnowledgeSearch />
      <Card>
        <CardHeader><CardTitle>오픈소스 지식 스택</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>설정 시 LightRAG가 선택적 GraphRAG 응답을 처리하며, 기본값은 로컬 데이터베이스 검색입니다.</p>
          <p>상태 엔드포인트: <code className="rounded bg-muted px-1 py-0.5">/api/knowledge?status=1</code></p>
          <p>Obsidian 볼트: <code className="rounded bg-muted px-1 py-0.5">knowledge/wiki</code></p>
          <p><code className="rounded bg-muted px-1 py-0.5">pnpm knowledge:*</code> 운영 스크립트로 OpenKB와 Graphify를 실행하세요.</p>
        </CardContent>
      </Card>
      <Card id="add-document">
        <CardHeader><CardTitle>문서 추가</CardTitle></CardHeader>
        <CardContent>
          <CreateKnowledgeForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>전체 문서 ({documents.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-xs text-muted-foreground italic">등록된 지식 문서가 없습니다.</p>
              <Link
                href="#add-document"
                className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
              >
                문서 추가
              </Link>
            </div>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0">
                <p className="font-medium">
                  <Link href={`/knowledge/${doc.id}`} className="hover:underline">{doc.title}</Link>
                </p>
                <p className="text-muted-foreground line-clamp-2">{doc.body}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{doc._count.chunks}개 조각 · {doc.source}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
