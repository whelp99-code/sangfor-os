import { test, expect } from '@playwright/test'
test.describe('CFO Finance Pages', () => {
  const pages = ['/cfo/dashboard', '/cfo/invoices', '/cfo/expenses', '/cfo/cashflows', '/cfo/vat', '/cfo/subscriptions', '/cfo/month-close', '/cfo/chat']
  pages.forEach(p => {
    test(`${p} loads successfully`, async ({ request }) => {
      const res = await request.get(`http://localhost:3101${p}`, { timeout: 10000 })
      expect(res.ok()).toBeTruthy()
    })
  })
})
