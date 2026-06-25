import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon = '📂', title, description, action }: EmptyStateProps) {
  return (
    <div role="status" className="flex flex-col items-center justify-center py-16 text-center">
      <span role="img" aria-hidden="true" className="mb-4 text-5xl">{icon}</span>
      <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
      {description && <p className="mb-6 text-sm text-gray-500">{description}</p>}
      {action}
    </div>
  )
}
