import { z } from "zod";

import { buildStaticMailPolicyLookup } from "./mail-policy-memory";

export const mailCandidateTypeSchema = z.enum([
  "customer",
  "partner",
  "task",
  "opportunity",
  "poc",
]);

export const mailCandidateStatusSchema = z.enum([
  "needs_revalidation",
  "proposed",
  "approved",
  "rejected",
  "converted",
  "knowledge_only",
]);

export const KEYWORDS = {
  opportunity: [
    "견적",
    "제안",
    "quote",
    "proposal",
    "purchase",
    "구매",
    "계약",
    "라이선스",
    "license",
    "renewal",
  ],
  poc: ["poc", "proof of concept", "검증", "테스트", "호환성", "compatibility", "pilot"],
  task: ["요청", "확인", "답변", "회신", "follow up", "action", "urgent", "긴급"],
  partner: ["partner", "파트너", "총판", "reseller", "distributor", "msp", "유통"],
} as const;

export const INTERNAL_COMPANY_NAMES = new Set(["베를로", "blro"]);

export const KNOWN_PARTNER_NAMES = new Set(["넥시아스", "nexias"]);
export const STATIC_POLICY_LOOKUP = buildStaticMailPolicyLookup();
