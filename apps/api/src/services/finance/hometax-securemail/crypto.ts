import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// 홈택스 공식 rollup을 격리된 vm 컨텍스트에서 로드해 CryptoJS를 추출한다.
// seed.js: core + MD5 + Base64 + SEED. aes.js: AES (동일 CryptoJS에 additive).
let cached: any | null = null;

export function loadCryptoJS(): any {
  if (cached) return cached;
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'vendor');
  const ctx: any = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(dir, 'seed.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(dir, 'aes.js'), 'utf8'), ctx);
  if (!ctx.CryptoJS?.SEED || !ctx.CryptoJS?.AES) {
    throw new Error('hometax CryptoJS rollups failed to load (SEED/AES missing)');
  }
  cached = ctx.CryptoJS;
  return cached;
}
