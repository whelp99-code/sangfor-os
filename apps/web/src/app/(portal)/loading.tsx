import { Skeleton } from '@sangfor/ui'

export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-sm text-muted-foreground" aria-live="polite">불러오는 중…</p>
      <Skeleton variant="card" count={3} />
      <Skeleton variant="table" count={5} />
    </div>
  )
}
