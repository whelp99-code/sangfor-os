"use client"

import * as React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface AIStatusCardProps {
  label: string
  value: string
  type?: "default" | "success" | "warning" | "error"
  icon?: React.ReactNode
}

export function AIStatusCard({ label, value, type = "default", icon }: AIStatusCardProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden border-l-4",
        type === "success" && "border-l-green-500",
        type === "warning" && "border-l-amber-500",
        type === "error" && "border-l-red-500",
        type === "default" && "border-l-gray-300"
      )}
    >
      <CardContent className="flex items-center gap-3 py-3">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-2xl font-bold">{value}</span>
        </div>
      </CardContent>
    </Card>
  )
}
