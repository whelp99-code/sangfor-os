import { test, expect } from '@playwright/test'

test.describe('System - Pages Load', () => {
  const pages = ['/dashboard', '/sales', '/presales', '/finance', '/delivery', '/support', '/agents', '/approvals']
  pages.forEach(p => {
    test(`Page ${p} loads successfully`, async ({ request }) => {
      const res = await request.get(`http://localhost:3101${p}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    })
  })
})

test.describe('System - Health API', () => {
  test('Unified health API returns all services', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/unified-health', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.services).toBeDefined()
  })

  test('Each health service has ok/degraded/error status', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/unified-health', { timeout: 10000 })
    const body = await res.json()
    for (const service of body.services || []) {
      expect(['ok', 'degraded', 'error']).toContain(service.status)
    }
  })

  test('Response times under 2 seconds', async ({ request }) => {
    const start = Date.now()
    const res = await request.get('http://localhost:3101/api/unified-health', { timeout: 10000 })
    const elapsed = Date.now() - start
    expect(res.ok()).toBeTruthy()
    expect(elapsed).toBeLessThan(2000)
  })
})

test.describe('System - Error Handling', () => {
  test('Not found page returns proper error state', async ({ request }) => {
    const res = await request.get('http://localhost:3101/nonexistent-page', { timeout: 10000 })
    expect(res.status()).toBe(404)
  })
})

test.describe('System - Page Titles', () => {
  test('Dashboard page title contains expected text', async ({ request }) => {
    const res = await request.get('http://localhost:3101/dashboard', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Sangfor')
  })

  test('Finance pages all load', async ({ request }) => {
    const pages = ['/cfo/dashboard', '/cfo/invoices', '/cfo/expenses', '/cfo/cashflows']
    for (const p of pages) {
      const res = await request.get(`http://localhost:3101${p}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    }
  })

  test('Settings pages all load', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/settings', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})
