export type ColorKey = 'blue' | 'red' | 'orange' | 'gray' | 'teal' | 'purple'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ColorAgentProfile {
  colorKey: ColorKey
  name: string
  description: string
  focusArea: string
}

export const COLOR_AGENTS: Record<ColorKey, ColorAgentProfile> = {
  blue: { colorKey: 'blue', name: 'Blue', description: '기술 방향성, 아키텍처, 구현 전략', focusArea: 'technical' },
  red: { colorKey: 'red', name: 'Red', description: '위험 및 보안, 규정 준수', focusArea: 'risk' },
  orange: { colorKey: 'orange', name: 'Orange', description: '비즈니스 가치, 제품 적합성', focusArea: 'business' },
  gray: { colorKey: 'gray', name: 'Gray', description: '문서화, 근거 자료, ADR', focusArea: 'documentation' },
  teal: { colorKey: 'teal', name: 'Teal', description: 'UX, 사용자 경험, 가시성', focusArea: 'ux' },
  purple: { colorKey: 'purple', name: 'Purple', description: '운영 런타임, 배포', focusArea: 'operations' },
}

export interface ColorRoutingInput {
  artifactType: string
  riskLevel: RiskLevel
  isCustomerFacing: boolean
  hasRestrictedData: boolean
  isCommercial: boolean
  affectsUI: boolean
  affectsArchitecture: boolean
}

export interface ColorRoutingResult {
  required: ColorKey[]
  optional: ColorKey[]
  rationale: string
}

export function routeColorAgents(input: ColorRoutingInput): ColorRoutingResult {
  const required: ColorKey[] = []
  const optional: ColorKey[] = []

  // Architecture change → Blue
  if (input.affectsArchitecture) required.push('blue')
  // Customer-facing → Gray (documentation)
  if (input.isCustomerFacing) required.push('gray')
  // Restricted data → Red (security)
  if (input.hasRestrictedData) required.push('red')
  // Commercial → Orange (business value)
  if (input.isCommercial) required.push('orange')
  // UI change → Teal (UX)
  if (input.affectsUI) required.push('teal')

  // Risk-based routing
  if (input.riskLevel === 'critical') {
    if (!required.includes('red')) required.push('red')
    if (!required.includes('blue')) required.push('blue')
    if (!required.includes('orange')) required.push('orange')
    if (!required.includes('gray')) required.push('gray')
  } else if (input.riskLevel === 'high') {
    if (!required.includes('red')) required.push('red')
    if (!required.includes('blue')) required.push('blue')
  } else if (input.riskLevel === 'medium') {
    optional.push('red')
    optional.push('blue')
  }

  return {
    required: [...new Set(required)],
    optional: [...new Set(optional)],
    rationale: `Risk ${input.riskLevel}: required [${required.join(', ')}], optional [${optional.join(', ')}]`,
  }
}

export function checkColorGate(required: ColorKey[], reviewed: ColorKey[], failed: ColorKey[]): boolean {
  const missing = required.filter(r => !reviewed.includes(r))
  if (missing.length > 0) return false
  const hasFailure = required.some(r => failed.includes(r))
  return !hasFailure
}
