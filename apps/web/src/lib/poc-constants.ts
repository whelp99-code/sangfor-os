export const POC_PRODUCT_LINES = [
  "HCI",
  "SCP",
  "aDR",
  "SASE",
  "VDI",
  "Security",
] as const;

export const POC_DEPLOYMENT_TYPES = [
  "신규",
  "전환",
  "DR",
  "확장",
  "PoC",
] as const;

export const POC_ISSUE_STATUSES = ["open", "in_progress", "resolved"] as const;

export const OPPORTUNITY_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "poc",
  "negotiation",
  "won",
  "lost",
] as const;
