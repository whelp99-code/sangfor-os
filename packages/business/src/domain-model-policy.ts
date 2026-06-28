import { GTM_PIPELINE, type GtmDomain } from "@sangfor/shared/modes";
import type { OpencodeModel } from "./opencode-client";
import type { DomainModelMap } from "./domain-llm";

/**
 * 데이터분류 기반 모델 게이팅.
 *
 * 라우팅은 "활성화 여부"가 아니라 **도메인 데이터 민감도 × 모델 허용분류**로 결정한다.
 * `AiModel.allowedDataClassification` / `isActive` 와 연계 — 민감 도메인(engineer/cfo)은
 * 해당 분류를 허용한 모델로만 라우팅되고, 허용 안 된 override 는 조용히 낮추지 않고 **거부**한다.
 */

export type DataClassification = "public" | "internal" | "confidential" | "restricted";

/** 도메인별 데이터 민감도 (소유 데이터 기준). 필요 시 override 로 조정. */
export const DOMAIN_DATA_CLASS: Record<GtmDomain, DataClassification> = {
  marketing: "internal", // 리드 (개인정보 가능)
  sales: "internal",
  presales: "internal",
  engineer: "restricted", // 고객 자산/현장/보안 구성
  cfo: "restricted", // 재무/마진/캐시플로우
};

export interface ModelPolicyEntry {
  providerID: string;
  modelID: string;
  allowedDataClassification: string[];
  isActive: boolean;
}

export interface GatedResolveInput {
  registry: ModelPolicyEntry[];
  overrides?: DomainModelMap;
  domainDataClass?: Partial<Record<GtmDomain, DataClassification>>;
}

export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

/** 모델이 요구 분류를 허용하는가 (명시적 포함). */
export function modelAllowsClass(allowed: string[], required: DataClassification): boolean {
  return allowed.includes(required);
}

/** 데이터분류 게이팅 라우팅: 도메인 분류를 커버하는 active 모델 중에서 선택. */
export function resolveDomainModelGated(domain: GtmDomain, input: GatedResolveInput): OpencodeModel {
  const required = input.domainDataClass?.[domain] ?? DOMAIN_DATA_CLASS[domain];
  const eligible = input.registry.filter(
    (m) => m.isActive && modelAllowsClass(m.allowedDataClassification, required),
  );
  if (eligible.length === 0) {
    throw new ModelPolicyError(
      `no active model permitted for domain '${domain}' (dataClass=${required})`,
    );
  }

  const override = input.overrides?.[domain];
  if (override) {
    const match = eligible.find(
      (m) => m.providerID === override.providerID && m.modelID === override.modelID,
    );
    if (match) return { providerID: match.providerID, modelID: match.modelID };
    // override 가 이 도메인 분류에 허용되지 않으면 조용히 낮추지 말고 거부.
    throw new ModelPolicyError(
      `override '${override.providerID}/${override.modelID}' not permitted for domain '${domain}' (dataClass=${required})`,
    );
  }

  const first = eligible[0];
  return { providerID: first.providerID, modelID: first.modelID };
}

/** 모든 GTM 도메인에 대해 게이팅 라우팅을 적용한 모델 맵. createOpencodeDomainGenerator 의 `models` 로 사용. */
export function buildGatedModelMap(input: GatedResolveInput): DomainModelMap {
  const map: DomainModelMap = {};
  for (const domain of GTM_PIPELINE) {
    map[domain] = resolveDomainModelGated(domain, input);
  }
  return map;
}

interface AiModelRow {
  provider: string;
  modelName: string;
  allowedDataClassification: string[];
  isActive: boolean;
}

/** AiModel 테이블 → 정책 레지스트리 (active 만). */
export async function loadModelPolicyFromDb(prismaLike: {
  aiModel: { findMany: (args: unknown) => Promise<AiModelRow[]> };
}): Promise<ModelPolicyEntry[]> {
  const rows = await prismaLike.aiModel.findMany({ where: { isActive: true } });
  return rows.map((r) => ({
    providerID: r.provider,
    modelID: r.modelName,
    allowedDataClassification: r.allowedDataClassification,
    isActive: r.isActive,
  }));
}
