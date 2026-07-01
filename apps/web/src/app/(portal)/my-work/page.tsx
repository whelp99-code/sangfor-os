export const dynamic = "force-dynamic";

import {
  listOpportunities,
  listWorkTasks,
  listGeneratedDocuments,
  listPocProjects,
  listCustomers,
  listPartners,
} from "@sangfor/business";
import { prisma } from "@sangfor/db";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/status-display";

export default async function MyWorkPage() {
  const results = await Promise.allSettled([
    listOpportunities(),         // index 0
    listWorkTasks(),             // index 1
    listGeneratedDocuments(),    // index 2
    listPocProjects(),           // index 3
    listCustomers(),             // index 4
    listPartners(),              // index 5
    prisma.mailDerivedCandidate.count({ where: { status: "proposed" } }),  // index 6
  ]);

  const opportunities = results[0].status === "fulfilled" ? results[0].value : null;
  const tasks = results[1].status === "fulfilled" ? results[1].value : null;
  const docs = results[2].status === "fulfilled" ? results[2].value : null;
  const pocProjects = results[3].status === "fulfilled" ? results[3].value : null;
  const customers = results[4].status === "fulfilled" ? results[4].value : null;
  const partners = results[5].status === "fulfilled" ? results[5].value : null;
  const pendingCount = results[6].status === "fulfilled" ? results[6].value : 0;

  // Section 1 — 영업기회 (진행 중)
  const activeOpps = opportunities
    ? opportunities.filter((opp) => opp.stage !== "WON" && opp.stage !== "LOST")
    : null;
  const activeOppsSlice = activeOpps ? activeOpps.slice(0, 8) : null;

  // Section 2 — 작업 (미완)
  const activeTasks = tasks ? tasks.filter((task) => task.status !== "done") : null;
  const activeTasksSlice = activeTasks ? activeTasks.slice(0, 8) : null;

  // Section 3 — 제안서
  const docsSlice = docs ? docs.slice(0, 8) : null;

  // Section 4 — PoC (진행 중)
  const activePoc = pocProjects
    ? pocProjects.filter(
        (poc) =>
          poc.status !== "done" &&
          poc.status !== "completed" &&
          poc.status !== "closed"
      )
    : null;
  const activePocSlice = activePoc ? activePoc.slice(0, 8) : null;

  // Section 6 — 고객/파트너 (최근)
  const recentCustomers = customers ? customers.slice(0, 4) : null;
  const recentPartners = partners ? partners.slice(0, 4) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">내 업무</h1>
        <p className="text-muted-foreground">
          진행 중인 모든 일을 한 곳에서 보고 바로 처리하세요.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Section 1 — 영업기회 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              영업기회 (진행 중)
              <Badge variant="secondary">{activeOpps ? activeOpps.length : 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeOpps === null ? (
              <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
            ) : activeOppsSlice && activeOppsSlice.length > 0 ? (
              <div className="space-y-1">
                {activeOppsSlice.map((opp) => (
                  <Link
                    key={opp.id}
                    href={`/opportunities/${opp.id}`}
                    className="group hover:bg-muted/30 rounded px-1 -mx-1 flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm"
                  >
                    <div>
                      <p className="font-medium">{opp.title}</p>
                      {opp.customer?.name && (
                        <p className="text-xs text-muted-foreground">{opp.customer.name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge>{statusLabel("opportunity", opp.stage)}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        ₩{Number(opp.amount ?? 0).toLocaleString()}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>진행 중인 영업기회가 없습니다.</p>
                <Link href="/opportunities" className="text-primary underline text-xs">
                  영업기회 추가
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2 — 작업 (미완) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              작업 (미완)
              <Badge variant="secondary">{activeTasks ? activeTasks.length : 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeTasks === null ? (
              <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
            ) : activeTasksSlice && activeTasksSlice.length > 0 ? (
              <div className="space-y-1">
                {activeTasksSlice.map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="group hover:bg-muted/30 rounded px-1 -mx-1 flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm"
                  >
                    <p className="font-medium">{task.title}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge>{statusLabel("task", task.status)}</Badge>
                      <Badge variant="outline">{statusLabel("task", task.priority)}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>완료되지 않은 작업이 없습니다.</p>
                <Link href="/tasks" className="text-primary underline text-xs">
                  작업 추가
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3 — 제안서 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              제안서 (초안/검토)
              <Badge variant="secondary">{docs ? docs.length : 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {docs === null ? (
              <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
            ) : docsSlice && docsSlice.length > 0 ? (
              <div className="space-y-1">
                {docsSlice.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/proposals/${doc.id}`}
                    className="group hover:bg-muted/30 rounded px-1 -mx-1 flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {doc.title ?? "제목 없음"}
                      </p>
                      {doc.customer?.name && (
                        <p className="text-xs text-muted-foreground">{doc.customer.name}</p>
                      )}
                    </div>
                    <Badge>{statusLabel("document", doc.status)}</Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>생성된 제안서가 없습니다.</p>
                <Link href="/proposals" className="text-primary underline text-xs">
                  제안서 생성
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 4 — PoC (진행 중) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              PoC (진행 중)
              <Badge variant="secondary">{activePoc ? activePoc.length : 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activePoc === null ? (
              <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
            ) : activePocSlice && activePocSlice.length > 0 ? (
              <div className="space-y-1">
                {activePocSlice.map((poc) => (
                  <Link
                    key={poc.id}
                    href={`/poc/${poc.id}`}
                    className="group hover:bg-muted/30 rounded px-1 -mx-1 flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm"
                  >
                    <div>
                      <p className="font-medium">{poc.title}</p>
                      {poc.customer?.name && (
                        <p className="text-xs text-muted-foreground">{poc.customer.name}</p>
                      )}
                    </div>
                    <Badge>{statusLabel("poc", poc.status)}</Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>진행 중인 PoC가 없습니다.</p>
                <Link href="/poc" className="text-primary underline text-xs">
                  PoC 추가
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 5 — 승인 대기 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              승인 대기
              <Badge variant="secondary">{pendingCount}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingCount > 0 ? (
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">검토 대기 중: {pendingCount}건</p>
                <Link
                  href="/approvals"
                  className="text-primary underline text-sm"
                >
                  검토하러 가기
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">승인 대기 항목이 없습니다.</p>
            )}
          </CardContent>
        </Card>

        {/* Section 6 — 고객/파트너 (최근) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              고객/파트너 (최근)
              <Badge variant="secondary">
                {(recentCustomers ? recentCustomers.length : 0) +
                  (recentPartners ? recentPartners.length : 0)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentCustomers === null && recentPartners === null ? (
              <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
            ) : (recentCustomers?.length ?? 0) === 0 && (recentPartners?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>등록된 고객/파트너가 없습니다.</p>
                <Link href="/customers" className="text-primary underline text-xs">
                  고객 추가
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {recentCustomers && recentCustomers.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide pb-0.5">
                      고객사
                    </p>
                    {recentCustomers.map((c) => (
                      <Link
                        key={c.id}
                        href={`/customers/${c.id}`}
                        className="group hover:bg-muted/30 rounded px-1 -mx-1 flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm"
                      >
                        <p className="font-medium">{c.name}</p>
                        {c.industry && (
                          <Badge variant="outline" className="text-xs">{c.industry}</Badge>
                        )}
                      </Link>
                    ))}
                  </>
                )}
                {recentPartners && recentPartners.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide pb-0.5 pt-2">
                      파트너
                    </p>
                    {recentPartners.map((p) => (
                      <Link
                        key={p.id}
                        href={`/partners/${p.id}`}
                        className="group hover:bg-muted/30 rounded px-1 -mx-1 flex items-center justify-between gap-2 py-1.5 border-b last:border-0 text-sm"
                      >
                        <p className="font-medium">{p.name}</p>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
