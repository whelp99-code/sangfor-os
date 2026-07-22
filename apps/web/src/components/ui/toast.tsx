"use client";

import {
  CheckCircle2,
  CircleAlert,
  Info,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: { label: string; onClick: () => void };
}

export interface ToastContextValue {
  toast: (type: ToastType, message: string, action?: Toast["action"]) => void;
  success: (message: string, action?: Toast["action"]) => void;
  error: (message: string, action?: Toast["action"]) => void;
  warning: (message: string, action?: Toast["action"]) => void;
  info: (message: string, action?: Toast["action"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_TOASTS = 5;

const toastMeta: Record<
  ToastType,
  { Icon: typeof CheckCircle2; label: string; iconClassName: string }
> = {
  success: { Icon: CheckCircle2, label: "성공", iconClassName: "text-primary" },
  error: { Icon: CircleAlert, label: "오류", iconClassName: "text-destructive" },
  warning: { Icon: TriangleAlert, label: "주의", iconClassName: "text-muted-foreground" },
  info: { Icon: Info, label: "안내", iconClassName: "text-primary" },
};

function durationFor(type: ToastType): number {
  return type === "error" ? 8_000 : 4_000;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idPrefix = useId().replace(/:/g, "");
  const nextToastId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (type: ToastType, message: string, action?: Toast["action"]) => {
      const id = `${idPrefix}-${++nextToastId.current}`;
      setToasts((current) => [
        ...current.slice(-(MAX_TOASTS - 1)),
        { id, type, message, action },
      ]);
    },
    [idPrefix],
  );

  useEffect(() => {
    const timers = toasts.map((current) =>
      window.setTimeout(() => dismiss(current.id), durationFor(current.type)),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismiss, toasts]);

  const value: ToastContextValue = {
    toast,
    success: (message, action) => toast("success", message, action),
    error: (message, action) => toast("error", message, action),
    warning: (message, action) => toast("warning", message, action),
    info: (message, action) => toast("info", message, action),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="알림"
      >
        {toasts.map((current) => {
          const { Icon, label, iconClassName } = toastMeta[current.type];
          return (
            <div
              key={current.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-lg"
              role="status"
              aria-live={current.type === "error" ? "assertive" : "polite"}
              aria-atomic="true"
            >
              <Icon
                className={`mt-0.5 size-4 shrink-0 ${iconClassName}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="sr-only">{label}</p>
                <p className="text-sm">{current.message}</p>
              </div>
              {current.action ? (
                <button
                  type="button"
                  onClick={current.action.onClick}
                  className="shrink-0 rounded px-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {current.action.label}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => dismiss(current.id)}
                aria-label={`${current.message} 알림 닫기`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
