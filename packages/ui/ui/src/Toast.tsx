'use client'
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  action?: { label: string; onClick: () => void }
}

export interface ToastContextValue {
  toast: (type: ToastType, message: string, action?: Toast['action']) => void
  success: (msg: string, action?: Toast['action']) => void
  error: (msg: string, action?: Toast['action']) => void
  warning: (msg: string, action?: Toast['action']) => void
  info: (msg: string, action?: Toast['action']) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const iconMap: Record<ToastType, string> = {
  success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️',
}
const colorMap: Record<ToastType, string> = {
  success: 'border-l-green-500 bg-green-50',
  error: 'border-l-red-500 bg-red-50',
  warning: 'border-l-amber-500 bg-amber-50',
  info: 'border-l-blue-500 bg-blue-50',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((type: ToastType, message: string, action?: Toast['action']) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts(prev => [...prev.slice(-4), { id, type, message, action }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === 'error' ? 0 : 4000)
  }, [])

  const ctx: ToastContextValue = {
    toast: addToast,
    success: (msg, a) => addToast('success', msg, a),
    error: (msg, a) => addToast('error', msg, a),
    warning: (msg, a) => addToast('warning', msg, a),
    info: (msg, a) => addToast('info', msg, a),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" role="region" aria-label="알림">
        {toasts.map(t => (
          <div key={t.id} role="alert" aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            className={`flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 shadow-lg
              animate-slide-in ${colorMap[t.type]} min-w-[320px] max-w-[480px]`}>
            <span aria-hidden="true">{iconMap[t.type]}</span>
            <p className="flex-1 text-sm text-gray-900">{t.message}</p>
            {t.action && (
              <button onClick={t.action.onClick} className="text-sm font-medium text-brand-600 hover:text-brand-700
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1">
                {t.action.label}
              </button>
            )}
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              aria-label="알림 닫기" className="text-gray-400 hover:text-gray-600">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
