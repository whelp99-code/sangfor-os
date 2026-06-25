import { test, expect } from '@playwright/test'
test.describe('Approval Flow', () => {
  test('Approvals list loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/approvals', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Approval detail loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/approvals/approval-001', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Color agent review status displayed', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Blue')
    expect(body).toContain('Red')
    expect(body).toContain('Orange')
    expect(body).toContain('Gray')
    expect(body).toContain('Teal')
  })
})
