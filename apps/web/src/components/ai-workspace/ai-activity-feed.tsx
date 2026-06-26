"use client"

import * as React from "react"
import { CheckCircle, Info, AlertTriangle, XCircle } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface ActivityItem {
  id: string
  time: string
  icon?: React.ReactNode
  text: string
  type: "success" | "info" | "warning" | "error"
}

interface AIActivityFeedProps {
  items: ActivityItem[]
}

function getTimeGroup(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return "방금 전"
  if (diffMin < 10) return "5분 전"
  if (diffMin < 60) return "30분 전"

  const hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours < 12 ? "오전" : "오후"
  const displayHours = hours % 12 || 12
  const displayMinutes = minutes.toString().padStart(2, "0")
  return `${ampm} ${displayHours}:${displayMinutes}`
}

function TypeIcon({ type }: { type: ActivityItem["type"] }) {
  switch (type) {
    case "success":
      return <CheckCircle className="size-4 text-green-500" />
    case "info":
      return <Info className="size-4 text-blue-500" />
    case "warning":
      return <AlertTriangle className="size-4 text-amber-500" />
    case "error":
      return <XCircle className="size-4 text-red-500" />
  }
}

function AnimatedItem({ item }: { item: ActivityItem }) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 10)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-l-2 py-2 pr-2 pl-3 transition-all duration-500 ease-out",
        item.type === "success" && "border-green-500 bg-green-500/5",
        item.type === "info" && "border-blue-500 bg-blue-500/5",
        item.type === "warning" && "border-amber-500 bg-amber-500/5",
        item.type === "error" && "border-red-500 bg-red-500/5",
        mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
    >
      <div className="mt-0.5 shrink-0">{item.icon ?? <TypeIcon type={item.type} />}</div>
      <div className="flex-1 space-y-0.5">
        <p className="text-sm leading-relaxed">{item.text}</p>
        <span className="text-xs text-muted-foreground">{getTimeGroup(new Date(item.time))}</span>
      </div>
      <Badge variant="outline" className="shrink-0 text-[10px]">
        {item.type}
      </Badge>
    </div>
  )
}

export function AIActivityFeed({ items }: AIActivityFeedProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const displayItems = items.slice(-50)

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [displayItems.length])

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">AI 활동 로그</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          ref={containerRef}
          className="flex flex-col gap-2 overflow-y-auto pr-1 max-h-[500px]"
        >
          {displayItems.map((item) => (
            <AnimatedItem key={item.id} item={item} />
          ))}
          {displayItems.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">활동 로그가 없습니다.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
