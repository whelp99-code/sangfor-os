"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
  SheetTrigger,
} from "@/components/ui/sheet";

type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: { value: string; label: string }[];
};

type EntityEditSheetProps = {
  title: string;
  endpoint: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
};

export function EntityEditSheet({
  title,
  endpoint,
  fields,
  initial,
}: EntityEditSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of fields) {
      init[field.name] = String(initial[field.name] ?? "");
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen(isOpen: boolean) {
    if (isOpen) {
      // Reset to initial values each time the sheet opens
      const init: Record<string, string> = {};
      for (const field of fields) {
        init[field.name] = String(initial[field.name] ?? "");
      }
      setValues(init);
      setError(null);
    }
    setOpen(isOpen);
  }

  function handleChange(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Only send changed fields
    const changed: Record<string, string> = {};
    for (const field of fields) {
      const initialVal = String(initial[field.name] ?? "");
      if (values[field.name] !== initialVal) {
        changed[field.name] = values[field.name];
      }
    }

    if (Object.keys(changed).length === 0) {
      setOpen(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          (body as { error?: string }).error ?? `오류가 발생했습니다 (${res.status})`
        );
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            수정
          </Button>
        }
      />
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 flex-1 overflow-y-auto px-4"
        >
          {fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label
                htmlFor={`field-${field.name}`}
                className="text-sm font-medium"
              >
                {field.label}
              </label>
              {field.type === "select" && field.options ? (
                <select
                  id={`field-${field.name}`}
                  value={values[field.name]}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`field-${field.name}`}
                  type={field.type === "number" ? "number" : "text"}
                  value={values[field.name]}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                />
              )}
            </div>
          ))}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </form>
        <SheetFooter>
          <SheetClose
            render={
              <Button type="button" variant="ghost">
                취소
              </Button>
            }
          />
          <Button type="submit" disabled={saving} onClick={handleSubmit}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
