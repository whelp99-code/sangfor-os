export const dynamic = "force-dynamic";

import { listCommandRuns } from "@sangfor/business";
import Link from "next/link";

import { CreateCommandForm } from "@/components/commands/create-command-form";
import { RegistryPageView } from "@/components/registry/registry-page-view";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function CommandsPage() {
  const runs = await listCommandRuns();

  return (
    <div className="space-y-6">
      <RegistryPageView
        pageKey="commands"
        title="Command Center"
        description="Create command runs with intent/risk analysis and workflow planning."
      />
      <CreateCommandForm />
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No command runs yet.</p>
      ) : (
        <div className="grid gap-3">
          {runs.map((command) => (
            <Card key={command.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-base">
                    {command.command.title}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {command.inputSummary ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{command.status}</Badge>
                  {command.risk ? (
                    <Badge variant="secondary">{command.risk.riskLevel}</Badge>
                  ) : null}
                  <Link
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    href={`/commands/${command.id}`}
                  >
                    Open detail
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Project: {command.project.name} · ID: {command.id}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
