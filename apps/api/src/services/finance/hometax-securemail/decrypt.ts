import { loadCryptoJS } from './crypto';
import type { SecureMailAlgorithm } from './header';

// 키 = MD5(사업자번호), IV = 16바이트 0, 모드 CBC(기본).
// CryptoJS.<ALG>.decrypt(base64Str, key, {iv}) → 평문은 base64 → Buffer로 디코드 → UTF-8 XML.
export function decryptAttachmentToXml(
  encBase64: string,
  businessNumber: string,
  algorithm: SecureMailAlgorithm,
): string {
  const C = loadCryptoJS();
  const cipher = algorithm === 'AES' ? C.AES : C.SEED; // ARIA 미지원 시 SEED 폴백(현 표본=SEED)
  if (algorithm === 'ARIA') {
    throw new Error('ARIA algorithm not supported yet (no sample); vendor aria.js when needed');
  }
  const key = C.MD5(businessNumber);
  const iv = C.enc.Hex.parse('0'.repeat(32));
  const decrypted = cipher.decrypt(encBase64, key, { iv });
  const b64 = decrypted.toString(C.enc.Utf8);
  return Buffer.from(b64, 'base64').toString('utf8');
}
