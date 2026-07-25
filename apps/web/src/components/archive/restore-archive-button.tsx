"use client";

import React, { useState } from "react";

interface Props {
  entityType: string;
  id: string;
  expectedVersion: string;
  onRestored?: () => void;
}

export function RestoreArchiveButton({ entityType, id, expectedVersion, onRestored }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setLoading(true);
    setError(null);
    try {
      const restoreStatus = ["customer", "partner"].includes(entityType)
        ? "inactive"
        : entityType === "poc"
        ? "planning"
        : entityType === "proposal"
        ? "draft"
        : undefined;

      const res = await fetch(`/api/archive/${entityType}/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion, restoreStatus }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "복원 실패");
      }
      onRestored?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="restore-archive-button-container">
      <button
        className="btn-restore"
        onClick={handleRestore}
        disabled={loading}
        data-testid="restore-button"
      >
        {loading ? "복원 중..." : "복원"}
      </button>
      {error && <span className="restore-error text-red-500 text-xs ml-2">{error}</span>}
    </div>
  );
}
