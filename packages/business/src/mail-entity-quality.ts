/**
 * mail-entity-quality.ts
 * Pure functions for normalizing and filtering mail-derived business entities.
 * No IO, no DB — all functions are pure.
 */

// ---------------------------------------------------------------------------
// Domain blocklists
// ---------------------------------------------------------------------------

const SELF_DOMAINS = new Set([
  'blro.co.kr',
  'berlo.co.kr',
  'sangfor.com',
  'sangfor.co.kr',
  'ai-portal.local',
]);

const MICROSOFT_DOMAINS = new Set(['microsoft.com']);

const SYSTEM_DOMAINS = new Set(['bill36524.com']);

const FREE_MAIL_DOMAINS = new Set([
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

const PLACEHOLDER_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'localhost',
]);

// Known domain -> company name map (takes priority over SLD derivation)
const KNOWN_DOMAIN_MAP: Record<string, string> = {
  'nexias.co.kr': '넥시아스',
  'nexias.com': '넥시아스',
  'gsitm.com': '지에스아이티엠',
  'gsenc.com': 'GS E&C',
};

// Two-part Korean ccTLD second-levels
const KR_TWO_PART_TLDS = new Set([
  'co.kr',
  'or.kr',
  'ne.kr',
  'go.kr',
  're.kr',
  'pe.kr',
  'mil.kr',
  'ac.kr',
]);

// ---------------------------------------------------------------------------
// normalizeSenderDomain
// ---------------------------------------------------------------------------

/**
 * Extract and normalize a domain from an email address or raw domain string.
 * Returns '' for empty/invalid input.
 */
export function normalizeSenderDomain(sourceSender?: string | null): string {
  if (!sourceSender) return '';

  let value = sourceSender.trim().toLowerCase();
  if (!value) return '';

  // If it looks like an email, take the part after '@'
  if (value.includes('@')) {
    const atIdx = value.indexOf('@');
    value = value.slice(atIdx + 1);
  }

  // Strip leading 'www.'
  if (value.startsWith('www.')) {
    value = value.slice(4);
  }

  return value;
}

// ---------------------------------------------------------------------------
// isBusinessEntityDomain
// ---------------------------------------------------------------------------

function isBlockedBySet(domain: string, set: Set<string>): boolean {
  if (set.has(domain)) return true;
  for (const blocked of set) {
    if (domain.endsWith('.' + blocked)) return true;
  }
  return false;
}

/**
 * Returns true if the domain belongs to a legitimate external business entity.
 */
export function isBusinessEntityDomain(domain: string): boolean {
  if (!domain) return false;

  if (isBlockedBySet(domain, SELF_DOMAINS)) return false;
  if (isBlockedBySet(domain, MICROSOFT_DOMAINS)) return false;
  if (isBlockedBySet(domain, SYSTEM_DOMAINS)) return false;
  if (isBlockedBySet(domain, FREE_MAIL_DOMAINS)) return false;
  if (isBlockedBySet(domain, PLACEHOLDER_DOMAINS)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// companyNameFromDomain
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable company name from a domain.
 * Known-map takes priority; otherwise Title-case the SLD.
 */
export function companyNameFromDomain(domain: string): string {
  if (!domain) return '';

  // Known-map lookup first
  if (KNOWN_DOMAIN_MAP[domain]) {
    return KNOWN_DOMAIN_MAP[domain];
  }

  // Extract SLD
  const parts = domain.split('.');

  let sld: string;
  if (parts.length >= 3) {
    // Check if last two parts form a known two-part TLD (e.g., co.kr)
    const lastTwo = parts.slice(-2).join('.');
    if (KR_TWO_PART_TLDS.has(lastTwo)) {
      // e.g. vclink.co.kr -> parts = ['vclink','co','kr'] -> parts[-3] = 'vclink'
      sld = parts[parts.length - 3];
    } else {
      // e.g. mails.microsoft.com -> parts[-2] = 'microsoft'
      sld = parts[parts.length - 2];
    }
  } else {
    // e.g. gsitm.com -> parts = ['gsitm','com'] -> parts[-2] = 'gsitm'
    sld = parts[parts.length - 2] ?? parts[0];
  }

  if (!sld) return '';

  // Title-case: capitalize first character
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

// ---------------------------------------------------------------------------
// isJunkCompanyName
// ---------------------------------------------------------------------------

const JUNK_SUBSTRINGS = [
  '견적',
  '요청',
  '회신',
  '문의',
  '답변',
  '안내',
  '완료',
  '등록',
  '전달',
  '확인',
  '재요청',
  '메일',
  'mails',
  '공지',
  '첨부',
  '발송',
  '수신',
  '접수',
];

const JUNK_PREFIX_REGEX = /^(re|fw|fwd|re:|fw:)/i;

/**
 * Returns true if the company name looks like noise (subject text, forward markers, etc.).
 */
export function isJunkCompanyName(name: string): boolean {
  if (!name) return true;
  if (name.length < 2) return true;

  // Forward/reply prefix
  if (JUNK_PREFIX_REGEX.test(name)) return true;

  const lower = name.toLowerCase();

  // Contains junk substrings
  for (const sub of JUNK_SUBSTRINGS) {
    if (lower.includes(sub.toLowerCase())) return true;
  }

  // Purely non-alphanumeric (no a-z, 0-9, or Korean syllables)
  if (!/[a-z0-9가-힣]/i.test(name)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// DerivedEntity + deriveEntityFromCandidate
// ---------------------------------------------------------------------------

export interface DerivedEntity {
  skip: boolean;
  reason?: string;
  name: string;
  domain: string;
}

/**
 * Derives a business entity from a mail candidate.
 * Domain is authoritative for name — even if the candidate title is junk,
 * a valid domain and non-junk derived name will yield skip=false.
 */
export function deriveEntityFromCandidate(input: {
  title?: string | null;
  sourceSender?: string | null;
  metadata?: any;
}): DerivedEntity {
  const domain =
    normalizeSenderDomain(input.sourceSender) ||
    normalizeSenderDomain(input.metadata?.domain);

  if (!isBusinessEntityDomain(domain)) {
    return { skip: true, reason: 'non_business_domain', name: '', domain };
  }

  const name = companyNameFromDomain(domain);

  if (isJunkCompanyName(name)) {
    return { skip: true, reason: 'junk_name', name, domain };
  }

  return { skip: false, name, domain };
}
