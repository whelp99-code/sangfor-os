import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { resolvePptxOutputPath } from './index.js';

describe('resolvePptxOutputPath', () => {
  const prevRoot = process.env.SANGFOR_OUTPUT_ROOT;

  afterEach(() => {
    if (prevRoot === undefined) {
      delete process.env.SANGFOR_OUTPUT_ROOT;
    } else {
      process.env.SANGFOR_OUTPUT_ROOT = prevRoot;
    }
  });

  it('returns resolve(outputPath) for explicit absolute outputPath', () => {
    delete process.env.SANGFOR_OUTPUT_ROOT;
    const dir = mkdtempSync(join(tmpdir(), 'u005-outpath-'));
    try {
      const outputPath = join(dir, 'explicit.pptx');
      const result = resolvePptxOutputPath({
        outputPath,
        defaultFilename: 'ignored.pptx',
      });
      expect(result).toBe(resolve(outputPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);
    }
  });

  it('joins SANGFOR_OUTPUT_ROOT with defaultFilename inside root', () => {
    const root = mkdtempSync(join(tmpdir(), 'u005-root-'));
    try {
      process.env.SANGFOR_OUTPUT_ROOT = root;
      const result = resolvePptxOutputPath({
        defaultFilename: 'Sangfor_설정가이드_MCP.pptx',
      });
      expect(result).toBe(resolve(root, 'Sangfor_설정가이드_MCP.pptx'));
      expect(result.startsWith(resolve(root) + sep)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws PPTX_OUTPUT_PATH_ESCAPE for path traversal via defaultFilename', () => {
    const root = mkdtempSync(join(tmpdir(), 'u005-escape-'));
    try {
      delete process.env.SANGFOR_OUTPUT_ROOT;
      expect(() =>
        resolvePptxOutputPath({
          outputRoot: root,
          defaultFilename: '../outside/x.pptx',
        }),
      ).toThrow(/PPTX_OUTPUT_PATH_ESCAPE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws PPTX_OUTPUT_ROOT_REQUIRED in test env without root or outputPath', () => {
    delete process.env.SANGFOR_OUTPUT_ROOT;
    expect(() =>
      resolvePptxOutputPath({
        defaultFilename: 'Sangfor_설정가이드_MCP.pptx',
      }),
    ).toThrow(/PPTX_OUTPUT_ROOT_REQUIRED/);
  });
});
