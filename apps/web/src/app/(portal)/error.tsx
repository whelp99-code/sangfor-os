'use client'

import { ErrorState } from '@sangfor/ui'

interface PortalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function PortalError({ error, reset }: PortalErrorProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h2 className="mb-4 text-center text-xl font-semibold text-foreground">문제가 발생했어요</h2>
        <ErrorState
          error={error.message || '알 수 없는 오류가 발생했습니다.'}
          details={error.digest ? `digest: ${error.digest}` : undefined}
          retry={reset}
        />
        <div className="mt-4 text-center">
          <button
            onClick={reset}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground
              hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            다시 시도
          </button>
        </div>
      </div>
    </div>
  )
}
