export type Deal = {
  id: string;
  code: string | null;          // PRJ-YYYY-NNNN (Project ID)
  title: string;
  stage: string;
  dealStatus: string | null;    // OPEN/WON/LOST/... (sourced in Slice 2; null for now)
  probability: number;
  amount: number | null;        // 공급가
  marginPct: number | null;     // derived, read-only (sourced in Slice 4; null for now)
  customer: string | null;
  partner: string | null;       // 총판 surrogate until Slice 4 distributor split
  productLine: string | null;   // 제품군 (sourced in Slice 2/5; null for now)
  regStatus: string | null;     // 딜등록 (sourced in Slice 4; null for now)
  owner: string | null;         // 담당 (sourced in Slice 2 ownerId; null for now)
  closeDate: string | null;     // 마감 (exists on Opportunity)
  nextAction: string | null;
  updatedAt: string;
};
