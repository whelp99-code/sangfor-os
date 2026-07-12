import Link from "next/link";

import { prisma } from "@sangfor/db";
import { isAutopilotEnabled } from "@sangfor/business";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { IntegrationHealthPanel } from "@/components/integrations/integration-health-panel";
import { LlmSettingsCard } from "@/components/settings/llm-settings-card";
import { AutopilotStatusRow } from "@/components/settings/autopilot-status-row";
import { PolicyMemoryManager } from "@/components/registry/policy-memory-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [policies, autopilotEnabled] = await Promise.all([
    prisma.policyMemory.findMany({ orderBy: { createdAt: "desc" } }),
    isAutopilotEnabled(),
  ]);

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
          <Link className={buttonVariants({ variant: "outline" })} href="/settings/mail-connection">
            메일 연동
          </Link>
        </CardContent>
      </Card>

      <LlmSettingsCard />

      <Card>
        <CardHeader>
          <CardTitle>AI 학습 및 필터 교정</CardTitle>
          <CardDescription>
            메일 인텔리전스가 제안한 필터 정책을 검토하고 활성화합니다. (레지스트리 관리에서도 확인할 수 있습니다)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AutopilotStatusRow enabled={autopilotEnabled} />
          <PolicyMemoryManager initialPolicies={policies} />
        </CardContent>
      </Card>

      <IntegrationHealthPanel compact />
    </div>
  );
}
