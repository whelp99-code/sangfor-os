import type { CommandRunStats, RegistryCounts } from "@/lib/registry/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MetricsBlock({
  title,
  data,
}: {
  title: string;
  data: RegistryCounts | CommandRunStats | null;
}) {
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">데이터 없음</CardContent>
      </Card>
    );
  }

  const entries =
    "modules" in data
      ? [
          { label: "모듈", value: data.modules },
          { label: "블록", value: data.blocks },
          { label: "쿼리", value: data.queries },
          { label: "레이아웃 슬롯", value: data.slots },
          { label: "노드", value: data.nodes },
          { label: "커넥터", value: data.connectors },
        ]
      : [
          { label: "총 실행", value: data.total },
          { label: "실행 중", value: data.running },
          { label: "대기 중", value: data.pending },
        ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {entries.map((entry) => (
          <div key={entry.label}>
            <p className="text-xs text-muted-foreground">{entry.label}</p>
            <p className="text-2xl font-semibold">{entry.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
