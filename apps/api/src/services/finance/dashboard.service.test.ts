import { describe, expect, it } from 'vitest';
import { DashboardService } from './dashboard.service';

const integration = process.env.CI_INTEGRATION === '1';
const service = new DashboardService();

// Integration: getCashflowForecast run-rate anchoring. Fix for the "cashflow
// forecast 앵커 시차" bug — revenue anchored to the latest deposit date, expense
// to the latest paid-expense date; when those two drift apart (~2 months in the
// live seed) the two run-rates come from different periods and the projection is
// distorted. The service now aligns both windows to a common anchor when the skew
// is within the trailing window, and otherwise surfaces anchorSkewWarning instead
// of silently zeroing one side.
describe.skipIf(!integration)('DashboardService.getCashflowForecast anchor alignment (integration)', () => {
  it('exposes anchor metadata and keeps run-rate windows consistent', async () => {
    const f = await service.getCashflowForecast(90);

    // New anchor metadata is always present.
    expect(f).toHaveProperty('anchorDate');
    expect(f).toHaveProperty('anchorSkewDays');
    expect(f).toHaveProperty('anchorSkewWarning');
    expect(typeof f.anchorSkewDays).toBe('number');
    expect(f.anchorSkewDays).toBeGreaterThanOrEqual(0);

    // When the two anchors are within the trailing window, both run-rate windows
    // share the common anchor's end date (aligned). When skew is large, the flag
    // is set so the divergence is explicit rather than hidden.
    if (!f.anchorSkewWarning && f.revenueWindow && f.expenseWindow) {
      expect(f.revenueWindow.to).toBe(f.expenseWindow.to);
      expect(f.revenueWindow.to).toBe(f.anchorDate);
    } else if (f.anchorSkewWarning) {
      // Skew exceeds the window: each side keeps its own (valid, non-empty) anchor
      // rather than one window collapsing to zero samples.
      expect(f.anchorSkewDays).toBeGreaterThan(30);
    }
  });
});
