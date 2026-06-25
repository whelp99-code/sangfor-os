import { test, expect } from '@playwright/test'
test.describe('System', () => {
  test('API health check', async ({ request }) => {
    const res = await request.get('http://localhost:3200/health', { timeout: 5000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
  test('API metrics endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3200/api/metrics', { timeout: 5000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Webhook GET endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3200/webhooks/outlook', { timeout: 5000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Settings persist', async ({ request }) => {
    const res1 = await request.get('http://localhost:3101/api/settings', { timeout: 5000 })
    expect(res1.ok()).toBeTruthy()
  })
  test('Sangfor OS branding visible', async ({ request }) => {
    const res = await request.get('http://localhost:3101/dashboard', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Sangfor Agentic')
  })
})
