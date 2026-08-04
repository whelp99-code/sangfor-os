/**
 * mail-domain-registry.ts
 * Single source of truth for mail-related domain classification constants
 * and email-domain normalization helpers. Consolidates domain lists that
 * were previously duplicated across mail-candidates.ts, mail-entity-quality.ts,
 * and mail-policy-memory.ts.
 */

/** 자사 도메인 (sangfor, blro 계열) */
export const SELF_DOMAINS = new Set([
  'sangfor.com',
  'sangfor.co.kr',
  'blro.co.kr',
  'ai-portal.local',
]);

/** 무료 메일 서비스 도메인 (개인 메일로 분류) */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  'kakao.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
]);

/** 알려진 파트너/공급사 도메인 */
export const KNOWN_PARTNER_DOMAINS = new Set([
  'nexias.co.kr',
]);

/** 시스템 발신자 (자동화, 빌링, 벤더 마케팅 플랫폼) */
export const SYSTEM_SENDER_DOMAINS = new Set([
  'bill36524.com',
  // Microsoft 365 marketing / account / subscription mail hosts
  'microsoft.com',
  'mails.microsoft.com',
  'email.microsoft.com',
  'accountprotection.microsoft.com',
  'communication.microsoft.com',
  'email.windows.com',
  'microsoftemail.com',
]);

/** 한국어 회사명 매핑 (메일 분류에 사용) */
export const KNOWN_DOMAIN_MAP: Record<string, string> = {
  'nexias.co.kr': '넥시아스',
  'nexias.com': '넥시아스',
  'gsitm.com': '지에스아이티엠',
  'gsenc.com': 'GS E&C',
};

/**
 * 이메일 도메인 정규화 (소문자, 부분 도메인 제거)
 * 예: user@mail.google.com → google.com
 */
export function normalizeEmailDomain(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const parts = domain.split('.');
  if (parts.length > 2 && !['co', 'ne'].includes(parts[parts.length - 2])) {
    return parts.slice(-2).join('.');
  }
  return domain;
}

/** 도메인이 자사 도메인인지 확인 */
export function isSelfDomain(domain: string): boolean {
  return SELF_DOMAINS.has(normalizeEmailDomain(domain));
}

/** 벤더/SaaS 지원 메일 판별 */
export function isVendorSupportSender(email: string): boolean {
  return email.includes('support@') && SYSTEM_SENDER_DOMAINS.has(normalizeEmailDomain(email));
}

/** 도메인 루트 추출 (subdomain.example.co.kr → example.co.kr) */
export function domainRoot(domain: string): string {
  return normalizeEmailDomain(domain);
}
