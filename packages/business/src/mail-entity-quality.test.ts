import { describe, it, expect } from 'vitest';
import {
  normalizeSenderDomain,
  isBusinessEntityDomain,
  companyNameFromDomain,
  isJunkCompanyName,
  deriveEntityFromCandidate,
} from './mail-entity-quality';

describe('normalizeSenderDomain', () => {
  it('returns plain domain unchanged', () => {
    expect(normalizeSenderDomain('gsitm.com')).toBe('gsitm.com');
  });

  it('extracts domain from email address', () => {
    expect(normalizeSenderDomain('jm.park@blro.co.kr')).toBe('blro.co.kr');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeSenderDomain('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(normalizeSenderDomain(null)).toBe('');
  });
});

describe('isBusinessEntityDomain', () => {
  it('accepts legitimate business domain gsitm.com', () => {
    expect(isBusinessEntityDomain('gsitm.com')).toBe(true);
  });

  it('accepts legitimate business domain vclink.co.kr', () => {
    expect(isBusinessEntityDomain('vclink.co.kr')).toBe(true);
  });

  it('rejects self/internal domain blro.co.kr', () => {
    expect(isBusinessEntityDomain('blro.co.kr')).toBe(false);
  });

  it('rejects self domain sangfor.com', () => {
    expect(isBusinessEntityDomain('sangfor.com')).toBe(false);
  });

  it('rejects subdomain of microsoft.com', () => {
    expect(isBusinessEntityDomain('mails.microsoft.com')).toBe(false);
  });

  it('rejects free mail domain gmail.com', () => {
    expect(isBusinessEntityDomain('gmail.com')).toBe(false);
  });

  it('rejects placeholder domain example.com', () => {
    expect(isBusinessEntityDomain('example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isBusinessEntityDomain('')).toBe(false);
  });

  it('rejects dotless string (no dot guard)', () => {
    expect(isBusinessEntityDomain('random_string')).toBe(false);
  });
});

describe('companyNameFromDomain', () => {
  it('returns known map name for gsitm.com', () => {
    expect(companyNameFromDomain('gsitm.com')).toBe('지에스아이티엠');
  });

  it('title-cases SLD for vclink.co.kr', () => {
    expect(companyNameFromDomain('vclink.co.kr')).toBe('Vclink');
  });

  it('returns known map name for nexias.co.kr', () => {
    expect(companyNameFromDomain('nexias.co.kr')).toBe('넥시아스');
  });
});

describe('isJunkCompanyName', () => {
  it('flags Korean noise subject "견적요청"', () => {
    expect(isJunkCompanyName('견적요청')).toBe(true);
  });

  it('flags forward prefix "FW"', () => {
    expect(isJunkCompanyName('FW')).toBe(true);
  });

  it('flags "Mails" exact match (Microsoft relay domain false company name)', () => {
    expect(isJunkCompanyName('Mails')).toBe(true);
  });

  it('accepts "Mailsoft" — not an exact junk match (regression for mails substring removal)', () => {
    expect(isJunkCompanyName('Mailsoft')).toBe(false);
  });

  it('flags "업체등록완료" (contains 등록, 완료)', () => {
    expect(isJunkCompanyName('업체등록완료')).toBe(true);
  });

  it('accepts legitimate company name "Gsenc"', () => {
    expect(isJunkCompanyName('Gsenc')).toBe(false);
  });

  it('accepts Korean company name "넥시아스"', () => {
    expect(isJunkCompanyName('넥시아스')).toBe(false);
  });
});

describe('deriveEntityFromCandidate', () => {
  it('rejects non-business domain (self domain)', () => {
    const result = deriveEntityFromCandidate({
      title: 'Customer: 견적요청',
      sourceSender: 'blro.co.kr',
    });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe('non_business_domain');
  });

  it('domain wins over junk subject — gsitm.com yields 지에스아이티엠', () => {
    const result = deriveEntityFromCandidate({
      title: 'Customer: 업체등록완료',
      sourceSender: 'gsitm.com',
    });
    expect(result.skip).toBe(false);
    expect(result.name).toBe('지에스아이티엠');
  });

  it('rejects microsoft subdomain', () => {
    const result = deriveEntityFromCandidate({
      title: 'Customer: Mails',
      sourceSender: 'mails.microsoft.com',
    });
    expect(result.skip).toBe(true);
    expect(result.reason).toBe('non_business_domain');
  });

  it('accepts nexias.co.kr and returns Korean name', () => {
    const result = deriveEntityFromCandidate({
      title: 'Partner: Nexias',
      sourceSender: 'nexias.co.kr',
    });
    expect(result.skip).toBe(false);
    expect(result.name).toBe('넥시아스');
  });
});
