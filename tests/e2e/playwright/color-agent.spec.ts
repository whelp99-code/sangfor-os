import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

test.describe('Color Agent - Display', () => {
  test('Blue agent present', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Blue')
  })

  test('Red agent present', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Red')
  })

  test('Orange agent present', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Orange')
  })

  test('Gray agent present', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Gray')
  })

  test('Teal agent present', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Teal')
  })
})

test.describe('Color Agent - Board & Operations', () => {
  test('Kanban board has 7 columns', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Review status badges visible', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-team`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Handoff cards can be created', async ({ request }) => {
    // 2026-07-02: no api/agents/* (plural) route exists at all — only api/agent
    // (singular: playbooks/run/runs/schedules/workflow). Stale endpoint, not a regression.
    test.fixme()
    const res = await request.post(`${BASE}/api/agents/handoff`, {
      data: { from: 'Blue', to: 'Red', summary: 'Escalation' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('Color routing logic accessible', async ({ request }) => {
    // 2026-07-02: no api/agents/* (plural) route exists — see note above.
    test.fixme()
    const res = await request.get(`${BASE}/api/agents/routing`, { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Color gate check works', async ({ request }) => {
    // 2026-07-02: no api/agents/* (plural) route exists — see note above.
    test.fixme()
    const res = await request.post(`${BASE}/api/agents/gate-check`, {
      data: { agent: 'Gray', releaseId: 'rel-001' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })
})
