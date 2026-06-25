import { test, expect } from '@playwright/test'
test.describe('Role Dashboards', () => {
  const dashboards = ['/sales', '/presales', '/finance', '/delivery', '/support']
  dashboards.forEach(d => {
    test(`${d} loads successfully`, async ({ request }) => {
      const res = await request.get(`http://localhost:3101${d}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    })
  })
  test('Executive dashboard loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/dashboard', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Color agents dashboard loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})
