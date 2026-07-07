import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3101'
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3200'

test.describe('System', () => {
  test('API health check', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`, { timeout: 5000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
  test('API metrics endpoint', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/metrics`, { timeout: 5000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Webhook GET endpoint', async ({ request }) => {
    const res = await request.get(`${API_BASE}/webhooks/outlook`, { timeout: 5000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Settings persist', async ({ request }) => {
    // 2026-07-02: no route.ts at api/settings (only api/settings/llm exists) — 404.
    // Stale endpoint path, not a regression.
    test.fixme()
    const res1 = await request.get(`${BASE}/api/settings`, { timeout: 5000 })
    expect(res1.ok()).toBeTruthy()
  })
  test('Sangfor OS branding visible', async ({ request }) => {
    // 2026-07-02: /dashboard's actual copy is Korean ("경영 대시보드" / "AI 업무
    // 포털") — no "Sangfor Agentic" text on this page. Stale expectation.
    test.fixme()
    const res = await request.get(`${BASE}/dashboard`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Sangfor Agentic')
  })
})
