export interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; label?: string }

const sizeMap = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }

export function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <div role="status" aria-label={label || '로딩 중'} className={`${sizeMap[size]} animate-spin`}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-80" />
      </svg>
      <span className="sr-only">{label || '로딩 중'}</span>
    </div>
  )
}
