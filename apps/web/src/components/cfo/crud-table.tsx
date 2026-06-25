"use client";

import { useState, useEffect, useCallback } from "react";

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
      const res = await fetch(`http://localhost:4100/api/${endpoint}`);
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
        ? `http://localhost:4100/api/${endpoint}/${editRow.id}`
        : `http://localhost:4100/api/${endpoint}`;
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
      const res = await fetch(`http://localhost:4100/api/${endpoint}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("삭제 실패");
      fetchData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={openCreate}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 추가
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left">
              {columns.map((col) => (
                <th key={col.key} className="p-3">
                  {col.label}
                </th>
              ))}
              <th className="p-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-4 text-center text-zinc-500">
                  로딩 중...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="p-4 text-center text-zinc-500">
                  데이터가 없습니다
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr key={row.id} className="border-b hover:bg-zinc-50">
                  {columns.map((col) => (
                    <td key={col.key} className="p-3">
                      {col.format ? col.format(row[col.key], row) : row[col.key] ?? "-"}
                    </td>
                  ))}
                  <td className="p-3 text-right">
                    <button
                      onClick={() => openEdit(row)}
                      className="mr-2 text-blue-600 hover:underline"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(row.id)}
                      className="text-red-600 hover:underline"
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
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">
              {editRow ? "수정" : "추가"}
            </h3>
            <div className="space-y-3">
              {fields.map((field) => (
                <div key={field.name}>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">
                    {field.label}
                  </label>
                  {field.type === "select" ? (
                    <select
                      value={formData[field.name] ?? ""}
                      onChange={(e) =>
                        setFormData({ ...formData, [field.name]: e.target.value })
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm"
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
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
