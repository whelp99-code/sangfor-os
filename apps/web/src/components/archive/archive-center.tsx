"use client";

import React, { useState } from "react";
import { RestoreArchiveButton } from "./restore-archive-button";

interface Props {
  initialNodes?: any[];
  totalCount?: number;
  truncated?: boolean;
}

export function ArchiveCenter({ initialNodes = [], totalCount = 0, truncated = false }: Props) {
  const [nodes, setNodes] = useState(initialNodes);

  function handleRestored(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }

  if (nodes.length === 0) {
    return (
      <div className="archive-center-empty p-6 text-center" data-testid="archive-center-empty">
        <p className="text-gray-500">보관된 항목이 없습니다</p>
      </div>
    );
  }

  return (
    <div className="archive-center space-y-4 p-4" data-testid="archive-center">
      <div className="archive-header flex justify-between items-center">
        <h2>보관함 센터</h2>
        {truncated && (
          <span className="text-xs text-amber-600">
            {totalCount}건 중 {nodes.length}건을 표시합니다
          </span>
        )}
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b">
            <th className="p-2">유형</th>
            <th className="p-2">ID / 제목</th>
            <th className="p-2">보관일 / 수정일</th>
            <th className="p-2">작동</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={`${node.entityType}-${node.id}`} className="border-b">
              <td className="p-2 uppercase text-xs font-semibold">{node.entityType}</td>
              <td className="p-2">{node.title || node.name || node.id}</td>
              <td className="p-2 text-xs">{new Date(node.updatedAt || node.createdAt).toLocaleString()}</td>
              <td className="p-2">
                <RestoreArchiveButton
                  entityType={node.entityType}
                  id={node.id}
                  expectedVersion={node.updatedAt}
                  onRestored={() => handleRestored(node.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
