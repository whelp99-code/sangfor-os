// Server-side importers must read these from a non-"use client" module: a
// client module's non-component exports become runtime client-reference
// proxies in the RSC server, so `DEAL_DETAIL_TABS.includes` would not exist.
export const DEAL_DETAIL_TABS = ["작업", "상세", "문서", "연락처", "채널·등록", "활동"] as const;
export type DealDetailTab = (typeof DEAL_DETAIL_TABS)[number];
