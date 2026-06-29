"use client";

import { useState, useEffect, useCallback } from "react";
import { CFO } from "@/lib/cfo-theme";

type FieldConfig = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: number;
};

type CrudTableProps = {
  title: string;
  endpoint: string;
  fields: FieldConfig[];
  columns: { key: string; label: string; format?: (val: any, row: any) => React.ReactNode }[];
};

export default function CrudTable({ title, endpoint, fields, columns }: CrudTableProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

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
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="p-3 text-left text-[11px] font-medium uppercase tracking-wide"
                >
                  {col.label}
                </th>
              ))}
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
            ) : data.length === 0 ? (
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
              data.map((row) => (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="w-full max-w-lg rounded-xl p-6 shadow-xl"
            style={{ background: CFO.paper, color: CFO.ink, border: `1px solid ${CFO.hairline}` }}
          >
            <h3 className="text-lg font-semibold tracking-tight">{editRow ? "수정" : "추가"}</h3>
            <div className="mt-1 mb-4 h-0.5 w-12" style={{ background: CFO.brass }} />
            <div className="space-y-3">
              {fields.map((field) => (
                <div key={field.name}>
                  <label
                    className="mb-1 block text-[11px] font-medium uppercase tracking-wide"
                    style={{ color: CFO.muted }}
                  >
                    {field.label}
                  </label>
                  {field.type === "select" ? (
                    <select
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
                    <label className="flex items-center gap-2">
                      <input
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
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
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
