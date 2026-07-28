"use client";

import React from "react";
import type { PageInfo } from "@sangfor/business";

interface Props {
  pageInfo: PageInfo;
  onNext?: () => void;
  onPrevious?: () => void;
}

export function CursorPagination({ pageInfo, onNext, onPrevious }: Props) {
  if (!pageInfo.hasNextPage && !pageInfo.hasPreviousPage) {
    return null;
  }

  return (
    <div className="cursor-pagination flex items-center justify-between p-4" data-testid="cursor-pagination">
      <button
        className="btn-previous px-4 py-2 text-sm border rounded disabled:opacity-50"
        onClick={onPrevious}
        disabled={!pageInfo.hasPreviousPage}
        aria-label="이전 페이지"
      >
        이전
      </button>
      <button
        className="btn-next px-4 py-2 text-sm border rounded disabled:opacity-50"
        onClick={onNext}
        disabled={!pageInfo.hasNextPage}
        aria-label="다음 페이지"
      >
        다음
      </button>
    </div>
  );
}
