import Link from "next/link";

export function AutopilotStatusRow({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${enabled ? "bg-green-500" : "bg-red-500"}`}
        />
        <span>
          오토파일럿 {enabled ? "ON" : "OFF"}{" "}
          <span className="text-muted-foreground">
            — {enabled ? "자율 실행 허용 · 도메인별 정책이 최종 게이트" : "킬스위치 작동 · 전 도메인 관찰 모드"}
          </span>
        </span>
      </div>
      <Link href="/ai-team" className="text-sm font-medium text-primary hover:underline">
        AI팀에서 제어 →
      </Link>
    </div>
  );
}
