import { loadCryptoJS } from './crypto';

export type SecureMailAlgorithm = 'AES' | 'SEED' | 'ARIA';
export interface SecureMailAttachment { tagId: string; fileName: string; size: number; }
export interface SecureMailHeader {
  algorithm: SecureMailAlgorithm;
  attachments: SecureMailAttachment[];
  hashKey: string;
  hintKey: string;
}

const ALG: Record<string, SecureMailAlgorithm> = { '1': 'AES', '2': 'SEED', '3': 'ARIA' };

// idCriHeader: Base64 디코드 → 각 바이트 XOR 0x6b → 'Key:Value' 줄들
export function decodeHeader(criHeaderBase64: string): SecureMailHeader {
  const C = loadCryptoJS();
  const wa = C.enc.Base64.parse(criHeaderBase64);
  const { words, sigBytes } = wa;
  let s = '';
  for (let i = 0; i < sigBytes; i++) {
    const b = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    s += String.fromCharCode(b ^ 0x6b);
  }
  const lines = s.split(/\r\n|\n/);
  const get = (line: string) => line.slice(line.indexOf(':') + 1).trim();

  let algorithm: SecureMailAlgorithm = 'SEED';
  let hashKey = '';
  let hintKey = '';
  const names: string[] = [];
  const tagIds: string[] = [];
  const sizes: number[] = [];

  for (const line of lines) {
    if (line.startsWith('ContentEncryptionAlgorithm')) algorithm = ALG[get(line)] ?? 'SEED';
    else if (line.startsWith('HashKey')) hashKey = get(line);
    else if (line.startsWith('HintKey')) hintKey = get(line);
    else if (line.startsWith('AttachFileName')) names.push(get(line));
    else if (line.startsWith('AttachFileTagID')) tagIds.push(get(line));
    else if (line.startsWith('AttachFileSize')) sizes.push(parseInt(get(line), 10) || 0);
  }

  const attachments: SecureMailAttachment[] = names.map((fileName, i) => ({
    fileName,
    tagId: tagIds[i] ?? `idCriAttachContents${i}`,
    size: sizes[i] ?? 0,
  }));

  return { algorithm, attachments, hashKey, hintKey };
}
