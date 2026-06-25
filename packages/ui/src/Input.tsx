'use client'
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, id, className = '', ...props }, ref) => {
    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`
    const errorId = `${inputId}-error`
    const helperId = `${inputId}-helper`

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{leftIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-gray-900
              placeholder:text-gray-400 transition-colors
              focus:outline-none focus:ring-2 focus:ring-offset-0
              ${error ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-brand-500'}
              ${leftIcon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''}
              disabled:bg-gray-100 disabled:text-gray-500
              ${className}`}
            {...props}
          />
          {rightIcon && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{rightIcon}</span>}
        </div>
        {error && <p id={errorId} role="alert" className="text-xs text-red-600">{error}</p>}
        {helperText && !error && <p id={helperId} className="text-xs text-gray-500">{helperText}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'
