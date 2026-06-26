"use client"

import * as React from "react"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface AICommandBarProps {
  onSend: (command: string) => void
  disabled?: boolean
  placeholder?: string
}

function Toast({ message, visible, onClose }: { message: string; visible: boolean; onClose: () => void }) {
  React.useEffect(() => {
    if (!visible) return
    const timer = setTimeout(onClose, 2000)
    return () => clearTimeout(timer)
  }, [visible, onClose])

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-0 bottom-full left-0 mb-2 flex justify-center transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
    >
      <div className="pointer-events-auto rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
        {message}
      </div>
    </div>
  )
}

export function AICommandBar({ onSend, disabled, placeholder = "AI 보조 명령을 입력하세요..." }: AICommandBarProps) {
  const [value, setValue] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleSend = React.useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || loading || disabled) return

    setLoading(true)
    try {
      await onSend(trimmed)
      setValue("")
      setSent(true)
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }, [value, loading, disabled, onSend])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <Card className="relative">
      <Toast message="명령 전송됨" visible={sent} onClose={() => setSent(false)} />
      <CardContent className="flex items-center gap-2 py-3">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          className="flex-1"
        />
        <Button
          onClick={handleSend}
          disabled={disabled || loading || !value.trim()}
          size="icon"
          aria-label="전송"
        >
          <Send className="size-4" />
        </Button>
      </CardContent>
    </Card>
  )
}
