import { test, expect } from '@playwright/test'
test.describe('Business API', () => {
  test('GET /api/customers returns list', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/customers', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('POST /api/customers creates customer', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/customers', { data: { name: 'Test Corp' }, timeout: 10000 })
    expect(res.status()).toBe(200)
  })
  test('GET /api/opportunities returns list', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/opportunities', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Unified health returns services', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/unified-health', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.services).toBeDefined()
  })
  test('Settings API returns config', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/settings', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})
