import { describe, it, expect } from 'vitest';
import { loadCryptoJS } from './crypto';

describe('loadCryptoJS', () => {
  it('exposes SEED, AES, MD5 and encoders', () => {
    const C = loadCryptoJS();
    expect(typeof C.SEED?.decrypt).toBe('function');
    expect(typeof C.AES?.decrypt).toBe('function');
    expect(typeof C.MD5).toBe('function');
    expect(C.enc?.Base64).toBeTruthy();
    expect(C.enc?.Hex).toBeTruthy();
  });

  it('MD5 of business number is a 128-bit word array (4 words)', () => {
    const C = loadCryptoJS();
    const key = C.MD5('4208702727');
    expect(key.words.length).toBe(4);
  });
});
