"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { cn } from "@/lib/utils";

export type KanbanColumnDef = { id: string; title: string; accent?: string };
export type KanbanItemBase = { id: string; columnId: string };

type KanbanBoardProps<T extends KanbanItemBase> = {
  columns: KanbanColumnDef[];
  items: T[];
  renderCard: (item: T) => ReactNode;
  onMove: (itemId: string, toColumnId: string) => void;
  columnSummary?: (columnId: string, items: T[]) => ReactNode;
};

function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("touch-none outline-none", isDragging && "opacity-30")}
    >
      {children}
    </div>
  );
}

function DroppableColumn({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-28 flex-1 flex-col gap-2 rounded-lg p-1.5 transition-colors",
        isOver && "bg-primary/5 ring-1 ring-primary/30"
      )}
    >
      {children}
    </div>
  );
}

/**
 * Generic drag-and-drop board (Pipedrive/monday pattern). Dragging a card to a
 * different column fires `onMove(itemId, toColumnId)` — callers persist + refresh.
 */
export function KanbanBoard<T extends KanbanItemBase>({
  columns,
  items,
  renderCard,
  onMove,
  columnSummary,
}: KanbanBoardProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const activeItem = items.find((item) => item.id === activeId) ?? null;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const overId = event.over?.id;
    if (overId == null) return;
    const item = items.find((candidate) => candidate.id === event.active.id);
    if (item && String(overId) !== item.columnId) onMove(item.id, String(overId));
  }

  const board = (
    <div className="grid auto-cols-[minmax(248px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 scrollbar-thin">
      {columns.map((column) => {
        const columnItems = items.filter((item) => item.columnId === column.id);
        return (
          <section
            key={column.id}
            className="flex flex-col rounded-xl border bg-muted/30"
          >
            <header className="flex items-center gap-2 border-b px-3 py-2">
              {column.accent ? (
                <span className={cn("size-2 rounded-full", column.accent)} aria-hidden="true" />
              ) : null}
              <span className="text-sm font-medium">{column.title}</span>
              <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {columnItems.length}
              </span>
            </header>
            <DroppableColumn id={column.id}>
              {columnItems.map((item) => (
                <DraggableCard key={item.id} id={item.id}>
                  {renderCard(item)}
                </DraggableCard>
              ))}
              {columnItems.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  비어 있음
                </p>
              ) : null}
            </DroppableColumn>
            {columnSummary ? (
              <footer className="border-t px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
                {columnSummary(column.id, columnItems)}
              </footer>
            ) : null}
          </section>
        );
      })}
    </div>
  );

  // Avoid SSR/client drag-context hydration mismatch.
  if (!mounted) return board;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {board}
      <DragOverlay>
        {activeItem ? <div className="rotate-2">{renderCard(activeItem)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
