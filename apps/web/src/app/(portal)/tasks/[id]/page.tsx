import { getWorkTaskDetail } from "@sangfor/business";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityEditSheet } from "@/components/common/entity-edit-sheet";

type PageProps = { params: Promise<{ id: string }> };

export default async function TaskDetailPage({ params }: PageProps) {
  const { id } = await params;
  const task = await getWorkTaskDetail(id);
  if (!task) notFound();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{task.title}</h1>
            <p className="text-muted-foreground">
              {task.customer?.name ?? task.partner?.name ?? "연결된 고객/파트너 없음"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <EntityEditSheet
              title="작업 수정"
              endpoint={`/api/tasks/${task.id}`}
              fields={[
                { name: "title", label: "제목" },
                { name: "status", label: "상태", type: "select", options: [
                  { value: "todo", label: "할 일" },
                  { value: "doing", label: "진행 중" },
                  { value: "waiting", label: "대기 중" },
                  { value: "done", label: "완료" },
                ]},
                { name: "priority", label: "우선순위", type: "select", options: [
                  { value: "low", label: "낮음" },
                  { value: "normal", label: "보통" },
                  { value: "high", label: "높음" },
                  { value: "urgent", label: "긴급" },
                ]},
              ]}
              initial={{ title: task.title, status: task.status, priority: task.priority }}
            />
            {/* Delete button intentionally absent: archiveWorkTask is still a
                hard prisma.delete — delete UX returns with soft-delete (PLAN §7). */}
          </div>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>상세 정보</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <Badge>{task.status}</Badge>
            <Badge variant="outline">{task.priority}</Badge>
          </div>
          {task.dueAt && <p>마감일: {task.dueAt.toISOString().slice(0, 10)}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
