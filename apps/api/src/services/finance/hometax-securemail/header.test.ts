import { describe, it, expect } from 'vitest';
import { encodeHeaderForTest } from './__fixtures__/synthetic';
import { decodeHeader } from './header';

describe('decodeHeader', () => {
  it('decodes algorithm and attachment metadata from a synthetic header', () => {
    const criHeader = encodeHeaderForTest({
      algorithm: 2, // SEED
      hashKey: 'HASHKEYVALUE',
      hintKey: '사업자등록번호(10자리)',
      attachments: [{ tagId: 'idCriAttachContents0', fileName: 'sample.xml', size: 6854 }],
    });
    const header = decodeHeader(criHeader);
    expect(header.algorithm).toBe('SEED');
    expect(header.attachments).toEqual([
      { tagId: 'idCriAttachContents0', fileName: 'sample.xml', size: 6854 },
    ]);
    expect(header.hashKey).toBe('HASHKEYVALUE');
  });
});
