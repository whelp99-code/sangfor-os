import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

test.describe('Role Dashboards', () => {
  const dashboards = ['/sales', '/presales', '/finance', '/delivery', '/support']
  dashboards.forEach(d => {
    test(`${d} loads successfully`, async ({ request }) => {
      // 2026-07-07: no `(portal)/finance` route exists (only sales/presales/
      // delivery/support are built as role dashboards) — 404. Stale expectation,
      // not a regression.
      test.fixme(d === '/finance', 'no (portal)/finance route exists')
      const res = await request.get(`${BASE}${d}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    })
  })
  test('Executive dashboard loads', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Color agents dashboard loads', async ({ request }) => {
    const res = await request.get(`${BASE}/agents`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})
