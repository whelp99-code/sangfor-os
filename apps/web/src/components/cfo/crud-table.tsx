"use client";

import { useState, useEffect, useCallback, useMemo, useId, useRef } from "react";
import { CFO } from "@/lib/cfo-theme";

type FieldConfig = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: number;
};

type ColumnConfig = {
  key: string;
  label: string;
  format?: (val: any, row: any) => React.ReactNode;
  /** Disable header-click sorting for this column (default: sortable). */
  sortable?: boolean;
  /** Custom value used for sorting; defaults to row[key] (objects fall back to .name/.id). */
  sortAccessor?: (row: any) => unknown;
};

/** A client-side filter rendered as a <select> above the table. */
type FilterConfig = {
  key: string;
  label: string;
  options: { value: string; label: string; test: (row: any) => boolean }[];
};

type CrudTableProps = {
  title: string;
  endpoint: string;
  fields: FieldConfig[];
  columns: ColumnConfig[];
  filters?: FilterConfig[];
};

type SortDir = "asc" | "desc";

function sortValue(row: any, col: ColumnConfig): unknown {
  if (col.sortAccessor) return col.sortAccessor(row);
  const v = row[col.key];
  if (v && typeof v === "object") return v.name ?? v.id ?? "";
  return v;
}

function compareRows(a: any, b: any, col: ColumnConfig, dir: SortDir): number {
  const av = sortValue(a, col);
  const bv = sortValue(b, col);
  // Nulls/empties always sort last regardless of direction.
  const aEmpty = av === null || av === undefined || av === "";
  const bEmpty = bv === null || bv === undefined || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let r: number;
  if (typeof av === "number" && typeof bv === "number") {
    r = av - bv;
  } else if (typeof av === "boolean" || typeof bv === "boolean") {
    r = (av ? 1 : 0) - (bv ? 1 : 0);
  } else {
    const ad = Date.parse(av as string);
    const bd = Date.parse(bv as string);
    if (!Number.isNaN(ad) && !Number.isNaN(bd)) r = ad - bd;
    else r = String(av).localeCompare(String(bv), "ko");
  }
  return dir === "asc" ? r : -r;
}

export default function CrudTable({ title, endpoint, fields, columns, filters }: CrudTableProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  // Modal a11y: title id, focus trap container, trigger restore.
  const modalTitleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const closeModal = useCallback(() => setShowModal(false), []);

  // Header-click sorting (client-side; third click clears).
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const toggleSort = (col: ColumnConfig) => {
    if (col.sortable === false) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
    }
  };

  // Client-side filters (e.g. 비용 납입여부: 전체/미납/완료).
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((filters ?? []).map((f) => [f.key, f.options[0]?.value ?? ""])),
  );

  const viewData = useMemo(() => {
    let rows = data;
    for (const f of filters ?? []) {
      const opt = f.options.find((o) => o.value === filterValues[f.key]);
      if (opt) rows = rows.filter(opt.test);
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) rows = [...rows].sort((a, b) => compareRows(a, b, col, sortDir));
    }
    return rows;
  }, [data, columns, filters, filterValues, sortKey, sortDir]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/finance/${endpoint}`);
      if (!res.ok) throw new Error("조회 실패");
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Modal: Escape to close, initial focus, Tab focus trap, restore focus on close.
  useEffect(() => {
    if (!showModal) return;

    triggerRef.current = (document.activeElement as HTMLElement) ?? null;

    const modal = modalRef.current;
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    // Initial focus on first field.
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (activeEl === first || !modal?.contains(activeEl)) {
            e.preventDefault();
            last.focus();
          }
        } else if (activeEl === last || !modal?.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [showModal, closeModal]);

  const openCreate = () => {
    setEditRow(null);
    setFormData({});
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    setEditRow(row);
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      if (f.type === "checkbox") {
        init[f.name] = row[f.name] ?? false;
      } else if (f.type === "date" && row[f.name]) {
        init[f.name] = new Date(row[f.name]).toISOString().split("T")[0];
      } else {
        init[f.name] = row[f.name] ?? "";
      }
    });
    setFormData(init);
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const url = editRow
        ? `/api/finance/${endpoint}/${editRow.id}`
        : `/api/finance/${endpoint}`;
      const method = editRow ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("저장 실패");
      setShowModal(false);
      fetchData();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/finance/${endpoint}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("삭제 실패");
      fetchData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="space-y-4" style={{ color: CFO.ink }}>
      {/* Masthead — ledger title with a single brass rule */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            onClick={openCreate}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: CFO.ink }}
          >
            + 추가
          </button>
        </div>
        <div className="mt-2 h-px w-full" style={{ background: CFO.hairline }} />
        <div className="h-0.5 w-16" style={{ background: CFO.brass }} />
      </div>

      {/* Filter bar — client-side selects (e.g. 납입여부) */}
      {filters && filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {filters.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5 text-sm" style={{ color: CFO.muted }}>
              <span className="text-[11px] font-medium uppercase tracking-wide">{f.label}</span>
              <select
                value={filterValues[f.key] ?? ""}
                onChange={(e) => setFilterValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="rounded-md px-2 py-1 text-sm"
                style={{ border: `1px solid ${CFO.hairline}`, background: "#fff", color: CFO.ink }}
              >
                {f.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <span className="text-xs tabular-nums" style={{ color: CFO.muted }}>
            {viewData.length}건
          </span>
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: CFO.outflow }}>
          {error}
        </p>
      )}

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: CFO.hairline, background: "#fff" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${CFO.hairline}`, color: CFO.muted }}>
              {columns.map((col) => {
                const sortable = col.sortable !== false;
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    aria-sort={
                      sortable
                        ? active
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                        : undefined
                    }
                    className="p-3 text-left text-[11px] font-medium uppercase tracking-wide"
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="flex items-center gap-1 uppercase tracking-wide hover:opacity-70"
                        style={{ color: active ? CFO.ink : "inherit" }}
                        aria-label={`${col.label} 정렬`}
                      >
                        {col.label}
                        <span aria-hidden="true" className="text-[9px]">
                          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              <th className="p-3 text-right text-[11px] font-medium uppercase tracking-wide">
                관리
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="p-4 text-center"
                  style={{ color: CFO.muted }}
                >
                  로딩 중...
                </td>
              </tr>
            ) : viewData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="p-4 text-center"
                  style={{ color: CFO.muted }}
                >
                  데이터가 없습니다
                </td>
              </tr>
            ) : (
              viewData.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors"
                  style={{ borderBottom: `1px solid ${CFO.hairline}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = CFO.paper)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="p-3 tabular-nums">
                      {col.format ? col.format(row[col.key], row) : row[col.key] ?? "-"}
                    </td>
                  ))}
                  <td className="p-3 text-right">
                    <button
                      onClick={() => openEdit(row)}
                      className="mr-3 hover:underline"
                      style={{ color: CFO.ink }}
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(row.id)}
                      className="hover:underline"
                      style={{ color: CFO.outflow }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 모달 */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeModal}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl p-6 shadow-xl"
            style={{ background: CFO.paper, color: CFO.ink, border: `1px solid ${CFO.hairline}` }}
          >
            <h3 id={modalTitleId} className="text-lg font-semibold tracking-tight">{editRow ? "수정" : "추가"}</h3>
            <div className="mt-1 mb-4 h-0.5 w-12" style={{ background: CFO.brass }} />
            <div className="space-y-3">
              {fields.map((field) => {
                const fieldId = `${modalTitleId}-${field.name}`;
                return (
                <div key={field.name}>
                  {field.type !== "checkbox" && (
                    <label
                      htmlFor={fieldId}
                      className="mb-1 block text-[11px] font-medium uppercase tracking-wide"
                      style={{ color: CFO.muted }}
                    >
                      {field.label}
                    </label>
                  )}
                  {field.type === "select" ? (
                    <select
                      id={fieldId}
                      value={formData[field.name] ?? ""}
                      onChange={(e) =>
                        setFormData({ ...formData, [field.name]: e.target.value })
                      }
                      className="w-full rounded-md px-3 py-2 text-sm"
                      style={{ border: `1px solid ${CFO.hairline}`, background: "#fff" }}
                    >
                      <option value="">선택</option>
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <label className="flex items-center gap-2" htmlFor={fieldId}>
                      <input
                        id={fieldId}
                        type="checkbox"
                        checked={formData[field.name] ?? false}
                        onChange={(e) =>
                          setFormData({ ...formData, [field.name]: e.target.checked })
                        }
                        className="h-4 w-4"
                        style={{ accentColor: CFO.ink }}
                      />
                      <span className="text-sm">{field.label}</span>
                    </label>
                  ) : (
                    <input
                      id={fieldId}
                      type={field.type}
                      value={formData[field.name] ?? ""}
                      step={field.step}
                      required={field.required}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          [field.name]:
                            field.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value,
                        })
                      }
                      className="w-full rounded-md px-3 py-2 text-sm tabular-nums"
                      style={{ border: `1px solid ${CFO.hairline}`, background: "#fff" }}
                    />
                  )}
                </div>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-4 py-2 text-sm transition-colors hover:opacity-80"
                style={{ border: `1px solid ${CFO.hairline}`, background: "#fff" }}
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: CFO.ink }}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
