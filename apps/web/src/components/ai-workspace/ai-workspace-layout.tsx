"use client"

import * as React from "react"
import { Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { AIActivityFeed, ActivityItem } from "./ai-activity-feed"
import { AICommandBar } from "./ai-command-bar"
import { AIStatusCard } from "./ai-status-card"

interface StatItem {
  label: string
  value: string
  type?: "default" | "success" | "warning" | "error"
}

interface AIWorkspaceLayoutProps {
  title: string
  subtitle?: string
  activities: ActivityItem[]
  stats?: StatItem[]
  onCommand?: (cmd: string) => void | string | Promise<void | string>
  children: React.ReactNode
}

export function AIWorkspaceLayout({
  title,
  subtitle,
  activities,
  stats,
  onCommand,
  children,
}: AIWorkspaceLayoutProps) {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <Badge variant="secondary" className="w-fit gap-1">
          <Zap className="size-3" />
          AI 보조 운영
        </Badge>
      </div>

      {/* Stats Row */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <AIStatusCard
              key={index}
              label={stat.label}
              value={stat.value}
              type={stat.type}
            />
          ))}
        </div>
      )}

      {/* Main Content + AI Panel */}
      <div className="flex flex-col gap-6 md:flex-row">
        {/* Left: Department Content */}
        <div className="flex-1 min-w-0">{children}</div>

        {/* Right: AI Panel */}
        <div className="flex flex-col gap-4 md:w-[380px]">
          <div className="sticky top-4 flex flex-col gap-4">
            <AIActivityFeed items={activities} />
            <AICommandBar
              onSend={onCommand ?? (() => {})}
              placeholder="AI 보조 명령을 입력하세요..."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
