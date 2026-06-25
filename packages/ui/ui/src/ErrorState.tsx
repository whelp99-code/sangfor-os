export interface ErrorStateProps {
  error: string
  retry?: () => void
  details?: string
}

export function ErrorState({ error, retry, details }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 py-12 text-center">
      <span aria-hidden="true" className="mb-4 text-4xl">⚠️</span>
      <h3 className="mb-2 text-lg font-semibold text-red-800">오류 발생</h3>
      <p className="mb-4 text-sm text-red-600">{error}</p>
      {details && <details className="mb-4 max-w-md text-left text-xs text-red-500"><summary>상세 정보</summary>{details}</details>}
      {retry && (
        <button onClick={retry} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white
          hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2">
          재시도
        </button>
      )}
    </div>
  )
}
