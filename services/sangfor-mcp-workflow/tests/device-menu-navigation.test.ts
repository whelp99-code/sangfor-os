import { describe, it, expect, vi } from 'vitest';

import { navigateToMenu } from '../scripts/lib/device-menu-capture';

/**
 * Minimal Playwright `Page` stand-in: only the members navigateToMenu touches.
 * `visible404Sequence` drives what the 404 probe sees on each successive check, so a test
 * can model "404 before the correction, still 404 after it".
 */
function fakePage(visible404Sequence: boolean[]) {
  const remaining = [...visible404Sequence];
  const evaluated: unknown[] = [];
  return {
    evaluated,
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
      // navigateToMenu passes the legacy hash through page.evaluate.
      if (arg !== undefined) {
        evaluated.push(arg);
        return undefined;
      }
      return undefined;
    }),
    getByText: vi.fn(() => ({
      isVisible: async () => remaining.shift() ?? false,
    })),
  };
}

describe('navigateToMenu IAG legacy-hash correction', () => {
  it('reports the correction as failed when the page still 404s afterwards', async () => {
    const page = fakePage([true, true]);

    const result = await navigateToMenu(
      page as never,
      'IAG',
      'https://device.invalid',
      '/#/system/status',
    );

    expect(page.evaluated).toEqual(['#system/status']);
    expect(result).toEqual({ corrected: true, is404: true });
  });

  it('reports a successful correction when the legacy hash resolves the 404', async () => {
    const page = fakePage([true, false]);

    const result = await navigateToMenu(
      page as never,
      'IAG',
      'https://device.invalid',
      '/#/system/status',
    );

    expect(result).toEqual({ corrected: true, is404: false });
  });

  it('does not attempt a correction when the first load is not a 404', async () => {
    const page = fakePage([false]);

    const result = await navigateToMenu(
      page as never,
      'IAG',
      'https://device.invalid',
      '/#/system/status',
    );

    expect(page.evaluated).toEqual([]);
    expect(result).toEqual({ corrected: false, is404: false });
  });
});
