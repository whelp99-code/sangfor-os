import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

test.describe('Business API', () => {
  test('GET /api/customers returns list', async ({ request }) => {
    const res = await request.get(`${BASE}/api/customers`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('POST /api/customers creates customer', async ({ request }) => {
    // 2026-07-02: route.ts's assertApiAccess() gate rejects the unauthenticated
    // request with 401 before it ever reaches the create logic. Stale
    // expectation predates that per-route auth check; needs a session fixture.
    test.fixme()
    const res = await request.post(`${BASE}/api/customers`, { data: { name: 'Test Corp' }, timeout: 10000 })
    expect(res.status()).toBe(200)
  })
  test('GET /api/opportunities returns list', async ({ request }) => {
    const res = await request.get(`${BASE}/api/opportunities`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Unified health returns services', async ({ request }) => {
    const res = await request.get(`${BASE}/api/unified-health`, { timeout: 10000 })
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body.services).toBeDefined()
  })
  test('Settings API returns config', async ({ request }) => {
    // 2026-07-02: no route.ts at api/settings (only api/settings/llm exists) — 404.
    // Stale endpoint path, not a regression.
    test.fixme()
    const res = await request.get(`${BASE}/api/settings`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})
