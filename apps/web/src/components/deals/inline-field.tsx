"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type InlineFieldProps = {
  label: string;
  value: React.ReactNode;
  /** Whether the field supports inline editing. Default: true */
  editable?: boolean;
  /** Derived field — rendered muted with a "자동" marker; no edit affordance */
  readOnly?: boolean;
  /** PATCH body key, e.g. "title" | "amount" | "dealType" */
  field?: string;
  inputType?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  opportunityId: string;
  /** Current raw value for the editor */
  rawValue?: string | number | null;
};

export function InlineField({
  label,
  value,
  editable = true,
  readOnly = false,
  field,
  inputType = "text",
  options,
  opportunityId,
  rawValue,
}: InlineFieldProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    rawValue != null ? String(rawValue) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = editable && !readOnly && !!field;

  async function save() {
    if (!field) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (inputType === "number") {
        body[field] = draft === "" ? null : Number(draft);
      } else if (inputType === "date") {
        body[field] = draft === "" ? null : new Date(draft).toISOString();
      } else {
        body[field] = draft === "" ? null : draft;
      }
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "저장 실패");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(rawValue != null ? String(rawValue) : "");
    setEditing(false);
    setError(null);
  }

  function startEdit() {
    if (!canEdit) return;
    setDraft(rawValue != null ? String(rawValue) : "");
    setEditing(true);
    setError(null);
  }

  return (
    <div
      className={cn(
        "group relative border-b border-border/40 px-1.5 py-2.5",
        canEdit && !editing && "cursor-text hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        editing && "rounded-md bg-primary/5 outline outline-1 outline-primary/30",
      )}
      onClick={!editing ? startEdit : undefined}
      role={canEdit && !editing ? "button" : undefined}
      tabIndex={canEdit && !editing ? 0 : undefined}
      onKeyDown={
        canEdit && !editing
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") startEdit();
            }
          : undefined
      }
      aria-label={canEdit && !editing ? `${label} 편집` : undefined}
    >
      {/* Label row */}
      <p className="mb-1 text-xs text-muted-foreground">
        {label}
        {readOnly && (
          <Badge
            variant="secondary"
            className="ml-1.5 px-1 py-0 text-[10px] font-normal"
          >
            자동
          </Badge>
        )}
      </p>

      {/* View mode */}
      {!editing && (
        <div
          className={cn(
            "min-h-[18px] text-sm font-semibold",
            readOnly && "text-muted-foreground",
          )}
        >
          {value ?? "—"}
          {canEdit && (
            <Pencil
              className="ml-1 inline size-3 opacity-0 transition-opacity group-hover:opacity-40"
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <div className="space-y-1.5">
          {inputType === "select" && options ? (
            <select
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-primary bg-background px-2 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
              aria-label={label}
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              autoFocus
              type={inputType}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
              disabled={saving}
              className="h-8 text-sm font-semibold"
              aria-label={label}
            />
          )}

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md border border-primary bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-md border px-2.5 py-1 text-[11px] font-bold text-foreground disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
