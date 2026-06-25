import type { ReactNode, HTMLAttributes } from 'react'

type CardElevation = 'flat' | 'raised' | 'overlay'
type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation
  padding?: CardPadding
  children: ReactNode
  /** If true, renders as <button> with AX attributes */
  clickable?: boolean
  /** Accessible label when clickable */
  ariaLabel?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
}

const elevationStyles: Record<CardElevation, string> = {
  flat: 'border border-gray-200 bg-white',
  raised: 'border border-gray-200 bg-white shadow-sm',
  overlay: 'border border-gray-200 bg-white shadow-lg',
}

const paddingStyles: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

export function Card({ elevation = 'raised', padding = 'md', clickable, ariaLabel, children, className = '', onClick, onKeyDown, ...props }: CardProps) {
  const baseClasses = `rounded-xl transition-all ${elevationStyles[elevation]} ${paddingStyles[padding]} ${className}`
  const clickableClasses = clickable ? 'cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2' : ''

  if (clickable) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        className={`${baseClasses} ${clickableClasses}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>)
          }
          onKeyDown?.(e)
        }}
        {...props}
      >
        {children}
      </div>
    )
  }

  return (
    <div className={`${baseClasses} ${clickableClasses}`} {...props}>
      {children}
    </div>
  )
}
