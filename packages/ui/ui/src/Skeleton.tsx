export interface SkeletonProps { variant?: 'text' | 'card' | 'avatar' | 'chart' | 'table'; width?: string; height?: string; count?: number }

export function Skeleton({ variant = 'text', width, height, count = 1 }: SkeletonProps) {
  const base = `animate-pulse rounded bg-gray-200 ${width || ''} ${height || ''}`
  const variants = {
    text: `${base} h-4 w-full`,
    card: `${base} h-32 w-full rounded-xl`,
    avatar: `${base} h-10 w-10 rounded-full`,
    chart: `${base} h-48 w-full rounded-xl`,
    table: `${base} h-8 w-full`,
  }

  return (
    <div role="status" aria-label="로딩 중" aria-busy="true" className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={variants[variant]} style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
      <span className="sr-only">로딩 중</span>
    </div>
  )
}
