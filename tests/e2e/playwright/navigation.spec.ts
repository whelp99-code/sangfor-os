import { test, expect } from '@playwright/test'

test.describe('Navigation - Sidebar Groups', () => {
  test('Business group navigation loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Business')
  })

  test('Finance group navigation loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Finance')
  })

  test('Intelligence group navigation loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Intelligence')
  })

  test('System group navigation loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('System')
  })
})

test.describe('Navigation - Links', () => {
  const links = ['/sales', '/presales', '/finance', '/delivery', '/support']
  links.forEach(link => {
    test(`Nav link ${link} returns 200`, async ({ request }) => {
      const res = await request.get(`http://localhost:3101${link}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    })
  })

  test('Color agents link works', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Mobile nav shows on small viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('http://localhost:3101', { waitUntil: 'networkidle', timeout: 15000 })
    const hamburger = page.locator('[data-testid="mobile-menu"]')
    await expect(hamburger).toBeVisible()
  })
})
