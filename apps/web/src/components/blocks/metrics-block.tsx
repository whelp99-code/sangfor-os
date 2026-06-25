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
        <CardContent className="text-sm text-muted-foreground">No data</CardContent>
      </Card>
    );
  }

  const entries =
    "modules" in data
      ? [
          { label: "Modules", value: data.modules },
          { label: "Blocks", value: data.blocks },
          { label: "Queries", value: data.queries },
          { label: "Layout slots", value: data.slots },
          { label: "Nodes", value: data.nodes },
          { label: "Connectors", value: data.connectors },
        ]
      : [
          { label: "Total runs", value: data.total },
          { label: "Running", value: data.running },
          { label: "Pending", value: data.pending },
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
