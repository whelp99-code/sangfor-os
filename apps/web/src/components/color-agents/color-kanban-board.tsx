"use client";

import { useState } from "react";
import { AlertTriangle, Clock, ArrowRight, GripVertical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type KanbanCard = {
  id: string;
  title: string;
  fromColor: string;
  toColor: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "in_review" | "done" | "blocked";
  dueDate: string;
  linkedArtifact: string;
};

type KanbanColumn = {
  name: string;
  cards: KanbanCard[];
};

const INITIAL_COLUMNS: KanbanColumn[] = [
  { name: "To Blue", cards: [] },
  { name: "To Red", cards: [] },
  { name: "To Orange", cards: [] },
  { name: "To Gray", cards: [] },
  { name: "To Teal", cards: [] },
  { name: "Resolved", cards: [] },
  { name: "Escalated", cards: [] },
];

function PriorityIndicator({ priority }: { priority: KanbanCard["priority"] }) {
  if (priority === "critical") return <AlertTriangle className="h-3 w-3 text-red-500" role="img" aria-label="Critical priority" />;
  if (priority === "high") return <AlertTriangle className="h-3 w-3 text-amber-500" role="img" aria-label="High priority" />;
  if (priority === "medium") return <Clock className="h-3 w-3 text-blue-500" role="img" aria-label="Medium priority" />;
  return <Clock className="h-3 w-3 text-gray-400" role="img" aria-label="Low priority" />;
}

function StatusBadge({ status }: { status: KanbanCard["status"] }) {
  const map: Record<KanbanCard["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pending", variant: "outline" },
    in_review: { label: "In Review", variant: "secondary" },
    done: { label: "Done", variant: "default" },
    blocked: { label: "Blocked", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

export function ColorKanbanBoard() {
  const [columns, setColumns] = useState<KanbanColumn[]>(INITIAL_COLUMNS);

  function handleAdvance(cardId: string) {
    setColumns((prev) => {
      const updated = prev.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== cardId),
      }));
      const card = prev.flatMap((col) => col.cards).find((c) => c.id === cardId);
      if (!card) return prev;

      const colorOrder = ["To Blue", "To Red", "To Orange", "To Gray", "To Teal", "Resolved", "Escalated"];
      const currentIdx = updated.findIndex((col) => col.name === card.toColor);
      if (currentIdx === -1 || currentIdx >= colorOrder.length - 1) return prev;

      const nextColName = colorOrder[currentIdx + 1];
      const nextCol = updated.find((col) => col.name === nextColName);
      if (!nextCol) return prev;

      const advancedCard: KanbanCard = {
        ...card,
        fromColor: card.toColor,
        toColor: nextColName,
        status: nextColName === "Resolved" ? "done" : nextColName === "Escalated" ? "blocked" : "in_review",
      };
      nextCol.cards.push(advancedCard);
      return [...updated];
    });
  }

  function handleEscalate(cardId: string) {
    setColumns((prev) => {
      const updated = prev.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== cardId),
      }));
      const escalCol = updated.find((col) => col.name === "Escalated");
      if (!escalCol) return prev;

      const card = prev.flatMap((col) => col.cards).find((c) => c.id === cardId);
      if (!card) return prev;

      escalCol.cards.push({ ...card, toColor: "Escalated", status: "blocked" });
      return [...updated];
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
          <GripVertical className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        </div>
        <CardTitle className="text-base">Kanban Board — Color Review Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="pb-2">
          <div className="flex gap-3 min-w-max">
            {columns.map((col) => (
              <div
                key={col.name}
                className="flex w-56 shrink-0 flex-col rounded-lg border bg-muted/20"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <h3 className="text-xs font-semibold">{col.name}</h3>
                  <Badge variant="outline" className="text-xs">{col.cards.length}</Badge>
                </div>
                <div className="flex flex-col gap-2 p-2 min-h-[100px]">
                  {col.cards.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">—</p>
                  ) : (
                    col.cards.map((card) => (
                      <div
                        key={card.id}
                        className="group rounded-lg border bg-background px-2.5 py-2 text-xs shadow-sm transition-shadow hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex items-center gap-1 min-w-0">
                            <PriorityIndicator priority={card.priority} />
                            <span className="truncate font-medium">{card.title}</span>
                          </div>
                          <StatusBadge status={card.status} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs px-1">{card.fromColor}</Badge>
                          <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                          <Badge variant="outline" className="text-xs px-1">{card.toColor}</Badge>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Due: {card.dueDate}</span>
                          <span>{card.linkedArtifact}</span>
                        </div>
                        {col.name !== "Resolved" && col.name !== "Escalated" && (
                          <div className="mt-2 flex gap-1 opacity-60 hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleAdvance(card.id)}
                              className="flex-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-brand-500"
                            >
                              Advance
                            </button>
                            <button
                              onClick={() => handleEscalate(card.id)}
                              className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-brand-500"
                            >
                              Escalate
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
