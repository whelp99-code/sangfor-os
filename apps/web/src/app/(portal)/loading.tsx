import { Skeleton } from "@/components/ui/skeleton";

export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">불러오는 중…</p>
      <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}
