'use client'
import { useState, useRef, useEffect, type ReactNode } from 'react'

export interface DropdownItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
}

export interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  ariaLabel?: string
  align?: 'left' | 'right'
}

export function Dropdown({ trigger, items, ariaLabel = '메뉴 열기', align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') setOpen(false)
      if (e instanceof MouseEvent && ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('click', handler); window.addEventListener('keydown', handler)
    return () => { window.removeEventListener('click', handler); window.removeEventListener('keydown', handler) }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open} aria-label={ariaLabel}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg">
        {trigger}
      </button>
      {open && (
        <div role="menu" className={`absolute z-50 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg
          ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((item, i) => (
            <button key={i} role="menuitem" onClick={() => { item.onClick(); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors
                focus-visible:outline-none focus-visible:bg-gray-100
                ${item.variant === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}>
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
