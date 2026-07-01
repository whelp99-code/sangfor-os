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
        <p className="text-muted-foreground">포털 구성 및 레지스트리 관리 (베타).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>관리</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link className={buttonVariants({ variant: "outline" })} href="/registry">
            레지스트리 관리
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/modules">
            모듈
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/tools">
            MCP 도구
          </Link>
        </CardContent>
      </Card>

      <LlmSettingsCard />

      <IntegrationHealthPanel compact />
    </div>
  );
}
