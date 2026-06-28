import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { IntegrationHealthPanel } from "@/components/integrations/integration-health-panel";
import { LlmSettingsCard } from "@/components/settings/llm-settings-card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">설정</h1>
        <p className="text-muted-foreground">Portal configuration and registry admin (Beta).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Administration</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link className={buttonVariants({ variant: "outline" })} href="/registry">
            Registry Admin
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/modules">
            Modules
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/tools">
            MCP Tools
          </Link>
        </CardContent>
      </Card>

      <LlmSettingsCard />

      <IntegrationHealthPanel compact />
    </div>
  );
}
