import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

test.describe('Approval Flow', () => {
  test('Approvals list loads', async ({ request }) => {
    const res = await request.get(`${BASE}/approvals`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Approval detail loads', async ({ request }) => {
    // 2026-07-07: 'approval-001' is not a seeded id (packages/db/prisma/seed.ts
    // creates approvalRequest rows with generated cuids) — 404. Same class of
    // stale placeholder id as cust-001/opp-001/poc-001 elsewhere in this suite.
    test.fixme()
    const res = await request.get(`${BASE}/approvals/approval-001`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
  test('Color agent review status displayed', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Blue')
    expect(body).toContain('Red')
    expect(body).toContain('Orange')
    expect(body).toContain('Gray')
    expect(body).toContain('Teal')
  })
})
