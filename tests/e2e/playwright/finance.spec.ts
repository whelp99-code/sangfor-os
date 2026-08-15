import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

// 2026-07-02: all 8 cases here currently pass, but this file duplicates
// system-health.spec.ts's "Finance pages all load" case over a subset of the
// same routes. Per the refactor master plan (Phase 0 §0-1), tag as a
// Phase 1 dead-code-deletion candidate rather than deleting now (Phase 0 is
// test-infra-only). The originating plan is archived as non-canonical history
// under docs/archive/discarded-plans/2026-08-13/plans/.
test.describe('CFO Finance Pages', () => {
  const pages = ['/cfo/dashboard', '/cfo/invoices', '/cfo/expenses', '/cfo/cashflows', '/cfo/vat', '/cfo/subscriptions', '/cfo/month-close', '/cfo/chat']
  pages.forEach(p => {
    test(`${p} loads successfully`, async ({ request }) => {
      const res = await request.get(`${BASE}${p}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    })
  })
})
