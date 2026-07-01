import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listRegistryAdminRows } from "@/lib/registry/service";
import { listConnectorRuntimeStates } from "@sangfor/business/action-connector-runtime";
import { prisma } from "@sangfor/db";
import { TemplateRegistryGrid } from "./template-registry-grid";
import { PolicyMemoryManager } from "./policy-memory-manager";
import { Badge } from "@/components/ui/badge";

export async function RegistryAdminPanel() {
  const [data, connectorStates, policies] = await Promise.all([
    listRegistryAdminRows(),
    listConnectorRuntimeStates(),
    prisma.policyMemory.findMany({
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      {/* Policy Memory and Template Explorers */}
      <div className="grid gap-6 lg:grid-cols-2">
        <PolicyMemoryManager initialPolicies={policies} />
        <TemplateRegistryGrid />
      </div>

      {/* Main Registries Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <RegistryCard
          title="모듈"
          rows={data.modules.map((m) => `${m.moduleKey} · v${m.version}`)}
        />
        <RegistryCard
          title="블록"
          rows={data.blocks.map((b) => `${b.blockKey} → ${b.moduleKey}`)}
        />
        <RegistryCard
          title="쿼리"
          rows={data.queries.map((q) => `${q.queryKey} (${q.sourceType})`)}
        />
        <RegistryCard
          title="레이아웃 슬롯"
          rows={data.slots.map(
            (s) =>
              `${s.pageKey}/${s.slotKey} → ${s.block?.blockKey ?? "unassigned"}`,
          )}
        />
        <RegistryCard
          title="노드"
          rows={data.nodes.map((n) => `${n.nodeKey} (${n.nodeType})`)}
        />

        {/* Dynamic Connectors Card */}
        <Card className="rounded-md border border-border shadow-sm">
          <CardHeader className="p-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>커넥터</span>
              <span className="text-xs text-muted-foreground font-mono">
                {connectorStates.length}개 등록됨
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {connectorStates.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">등록된 커넥터가 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {connectorStates.map((c) => {
                  const badgeVariant =
                    c.effectiveMode === "real"
                      ? "default"
                      : c.effectiveMode === "read_only"
                        ? "secondary"
                        : "outline";

                  const badgeClass =
                    c.effectiveMode === "real"
                      ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20"
                      : c.effectiveMode === "read_only"
                        ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20"
                        : "bg-muted text-muted-foreground";

                  return (
                    <div key={c.connectorKey} className="text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-medium">{c.connectorKey}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={badgeVariant} className={`text-xs px-1.5 py-0 ${badgeClass}`}>
                            {c.effectiveMode}
                          </Badge>
                          {!c.credentialsPresent && (
                            <span className="text-xs text-amber-600 bg-amber-500/5 px-1 py-0.2 rounded border border-amber-500/10" title="설정 / 환경 자격 증명 누락">
                              자격 증명 누락
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">
                        {c.description}
                      </p>
                      {c.warnings.length > 0 && (
                        <div className="text-xs text-muted-foreground leading-relaxed pl-2 border-l border-border mt-0.5">
                          {c.warnings.map((warn, i) => (
                            <div key={i} className="truncate" title={warn}>
                              <span role="img" aria-label="경고">⚠️</span> {warn}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RegistryCard({ title, rows }: { title: string; rows: string[] }) {
  return (
    <Card className="rounded-md border border-border shadow-sm">
      <CardHeader className="p-4 border-b border-border">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">등록된 항목이 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground font-mono">
            {rows.map((row) => (
              <li key={row} className="break-all leading-normal flex items-start gap-1">
                <span className="text-primary select-none">&middot;</span>
                <span>{row}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
