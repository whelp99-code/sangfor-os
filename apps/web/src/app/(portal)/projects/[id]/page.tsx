import { getProjectHub, listTasksByEngagement } from "@sangfor/business";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CFO } from "@/lib/cfo-theme";
import { LaneDecisionControls } from "@/components/hub/lane-decision-controls";
import { LaneGenerateButton } from "@/components/hub/lane-generate-button";
import { CreateTaskForm } from "@/components/tasks/create-task-form";
import { TaskBoard } from "@/components/tasks/task-board";
import { formatKRW } from "@sangfor/shared";

type PageProps = { params: Promise<{ id: string }> };
const DOMAIN_LABEL: Record<string, string> = { marketing: "마케팅", sales: "세일즈", presales: "프리세일즈", engineer: "엔지니어", cfo: "CFO" };
const DOT: Record<string, string> = { done: "●", active: "◐", pending: "○" };
const LENS_KO: Record<string, string> = { blue: "기술", red: "리스크", orange: "가치", gray: "근거", teal: "UX" };
const LENS_ORDER = ["blue", "red", "orange", "gray", "teal"] as const;

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [hub, tasks] = await Promise.all([getProjectHub(id), listTasksByEngagement(id)]);
  if (!hub) notFound();
  const { engagement, lanes, pnl } = hub;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: CFO.ink }}>{engagement!.name}</h1>
        <p className="text-muted-foreground">{engagement!.opportunity?.customer?.name ?? "고객 미연결"} · {engagement!.status}</p>
        <div className="mt-1 h-0.5 w-12" style={{ background: CFO.brass }} />
      </div>

      {/* 도메인 파이프라인 바 */}
      <div className="flex items-center gap-2 text-sm">
        {lanes.map((l, i) => (
          <span key={l.domain} className="flex items-center gap-2">
            <span style={{ color: l.status === "pending" ? CFO.muted : CFO.ink }}>{DOT[l.status]} {DOMAIN_LABEL[l.domain]}</span>
            {i < lanes.length - 1 && <span style={{ color: CFO.hairline }}>──▶</span>}
          </span>
        ))}
      </div>

      {/* CFO 손익 스트립 */}
      <Card>
        <CardHeader><CardTitle>딜 손익</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 tabular-nums">
            <div><div className="text-xs text-muted-foreground">매출</div><div style={{ color: CFO.inflow }}>{formatKRW(pnl.revenue)}</div></div>
            <div><div className="text-xs text-muted-foreground">매입</div><div style={{ color: CFO.outflow }}>{formatKRW(pnl.purchase)}</div></div>
            <div><div className="text-xs text-muted-foreground">비용</div><div style={{ color: CFO.outflow }}>{formatKRW(pnl.expense)}</div></div>
            <div><div className="text-xs text-muted-foreground">마진</div><div style={{ color: pnl.margin >= 0 ? CFO.inflow : CFO.outflow }}>{formatKRW(pnl.margin)} ({pnl.marginPct}%)</div></div>
          </div>
        </CardContent>
      </Card>

      {/* 도메인 학습 안내 */}
      <p className="text-xs text-muted-foreground">AI 제안을 사람이 승인/수정/반려하면 그 결정이 도메인 학습으로 반영되어 자율도가 올라갑니다.</p>

      {/* 도메인 레인 */}
      <div className="grid gap-4 md:grid-cols-2">
        {lanes.map((l) => (
          <Card key={l.domain}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{DOMAIN_LABEL[l.domain]}</CardTitle>
              <Badge variant="outline">{DOT[l.status]} {l.status}</Badge>
            </CardHeader>
            <CardContent>
              {l.autonomy && (
                <p className="text-xs mb-2" style={{ color: CFO.muted }}>
                  {l.autonomy.pct !== null
                    ? `자율도 ${l.autonomy.pct}% · ${l.autonomy.label} (표본 ${l.autonomy.sample})`
                    : `자율도 학습중 (표본 ${l.autonomy.sample})`}
                </p>
              )}
              {/* AI 제안 목록 */}
              {l.proposals && l.proposals.length > 0 && (
                <div className="mb-3 space-y-2">
                  {l.proposals.map((p) => (
                    <div key={p.id} className="rounded border p-2 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{p.title}</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 text-[10px]">AI 제안 · 검토대기</span>
                      </div>
                      <p className="text-muted-foreground line-clamp-2">{p.bodyMarkdown}</p>
                      {p.colorGate && (
                        <div className="mt-2 border-t pt-1.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {LENS_ORDER.map((k) => {
                              const lens = p.colorGate!.lenses[k];
                              return (
                                <span
                                  key={k}
                                  title={`${LENS_KO[k]}: ${lens.note}`}
                                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                  style={{ background: lens.pass ? "#2E7D5B" : "#C0392B" }}
                                >
                                  {k[0].toUpperCase()}
                                </span>
                              );
                            })}
                            <span
                              className={`ml-1 rounded-full px-2 py-0.5 text-[10px] ${p.colorGate.pass ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                            >
                              컬러 검증 {p.colorGate.pass ? "통과" : "보류"}
                            </span>
                          </div>
                          {p.colorGate.summary && (
                            <p className="mt-1 text-[11px] text-muted-foreground">{p.colorGate.summary}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {l.artifacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">산출물 없음</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {l.artifacts.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span>{a.label}</span>
                      {a.status && <Badge variant="secondary">{a.status}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              <LaneGenerateButton projectId={id} domain={l.domain} />
              <LaneDecisionControls projectId={id} domain={l.domain} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 프로젝트 작업 */}
      <Card>
        <CardHeader><CardTitle>작업 ({tasks.length})</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <CreateTaskForm engagementId={id} />
          <TaskBoard tasks={tasks} />
        </CardContent>
      </Card>
    </div>
  );
}
