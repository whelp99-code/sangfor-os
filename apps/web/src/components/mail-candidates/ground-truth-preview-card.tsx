import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type GroundTruthPreviewView = {
  readonly changes: readonly {
    readonly id: string;
    readonly title: string;
    readonly from: "customer" | "partner";
    readonly to: "customer" | "partner";
    readonly entityKey: string;
    readonly relationshipKeys: readonly string[];
    readonly evidence: readonly {
      readonly relationshipKey: string;
      readonly businessProject: string;
      readonly role: string;
      readonly evidenceTier: "A" | "B" | "C" | "D";
      readonly sourceArtifactIds: readonly string[];
    }[];
  }[];
  readonly humanReview: readonly {
    readonly id: string;
    readonly entityKey: string;
    readonly reason: "conflicting_project_roles";
  }[];
  readonly unchanged: readonly string[];
  readonly writeOperationsPrevented: number;
  readonly scanned: number;
  readonly writesPerformed: 0;
};

type Props = {
  readonly candidateId: string;
  readonly manifestId: string | null;
  readonly preview: GroundTruthPreviewView | null;
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  channel_partner: "채널 파트너",
  supplier: "공급사",
  distributor: "총판",
  end_customer: "최종 고객",
  direct_customer: "직접 고객",
  billed_counterparty: "청구 상대",
};

function Metric({
  label,
  testId,
  value,
}: {
  readonly label: string;
  readonly testId?: string;
  readonly value: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value}</p>
    </div>
  );
}

export function GroundTruthPreviewCard({
  candidateId,
  manifestId,
  preview,
}: Props) {
  const change = preview?.changes.find((entry) => entry.id === candidateId);
  const conflict = preview?.humanReview.find(
    (entry) => entry.id === candidateId,
  );

  return (
    <Card data-testid="gt-preview">
      <CardHeader>
        <CardTitle>근거 대장 대조 (읽기 전용)</CardTitle>
        <p className="text-xs text-muted-foreground">
          회계·계약 대장과 이 후보를 대조한 결과입니다. 이 화면은 아무것도
          변경하지 않습니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-base sm:text-sm">
        {!preview ? (
          <>
            <Badge variant="outline" data-testid="gt-preview-badge">
              대조 불가
            </Badge>
            <p className="text-muted-foreground">
              근거 대장을 불러올 수 없어 대조를 건너뛰었습니다. 승인 판단에는
              영향이 없습니다.
            </p>
          </>
        ) : conflict ? (
          <>
            <Badge variant="destructive" data-testid="gt-preview-badge">
              역할 충돌 · 사람 검토 필요
            </Badge>
            <div
              role="status"
              data-testid="gt-preview-conflict"
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-800 dark:text-red-200"
            >
              같은 거래처가 프로젝트마다 다른 역할을 가집니다. 자동 판단을
              중단했으며 근거를 직접 확인해야 합니다.
            </div>
            <Metric label="대장 개체" value={conflict.entityKey} />
          </>
        ) : change ? (
          <>
            <Badge variant="outline" data-testid="gt-preview-badge">
              재분류 제안
            </Badge>
            <div className="grid gap-2 sm:grid-cols-2">
              <Metric label="현재 유형" value={change.from} />
              <Metric label="대장 근거 유형" value={`${change.to} · 제안`} />
            </div>
            <div className="space-y-2" data-testid="gt-preview-evidence">
              <p className="font-medium">대장 근거</p>
              {change.evidence.map((evidence) => (
                <div
                  key={evidence.relationshipKey}
                  className="rounded-md border bg-muted/30 px-3 py-2"
                >
                  <p className="break-words font-medium">
                    {evidence.businessProject} ·{" "}
                    {ROLE_LABELS[evidence.role] ?? evidence.role} ·{" "}
                    {evidence.evidenceTier}등급
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    관계 {evidence.relationshipKey} · 출처{" "}
                    {evidence.sourceArtifactIds.join(", ")}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground">
              제안일 뿐이며 유형은 변경되지 않았습니다. 변경하려면 위 유형
              전환을 사용하세요.
            </p>
          </>
        ) : (
          <>
            <Badge variant="outline" data-testid="gt-preview-badge">
              대장 근거 없음
            </Badge>
            <p className="text-muted-foreground">
              이 후보와 일치하는 승인 대장 항목이 없습니다. 기존 메일 근거로
              판단하세요.
            </p>
          </>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          <Metric
            label="검사 후보"
            value={`${preview?.scanned ?? 0}건`}
          />
          <Metric
            label="차단된 쓰기"
            value={`${preview?.writeOperationsPrevented ?? 0}건`}
          />
          <Metric
            label="쓰기 작업"
            testId="gt-preview-writes"
            value={`${preview?.writesPerformed ?? 0}건 (미리보기 전용)`}
          />
        </div>
        {manifestId ? (
          <p className="break-words text-xs text-muted-foreground">
            승인 bootstrap 대장: {manifestId}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
