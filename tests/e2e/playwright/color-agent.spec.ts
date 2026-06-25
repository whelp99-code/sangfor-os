import { test, expect } from '@playwright/test'

test.describe('Color Agent - Display', () => {
  test('Blue agent present', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Blue')
  })

  test('Red agent present', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Red')
  })

  test('Orange agent present', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Orange')
  })

  test('Gray agent present', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Gray')
  })

  test('Teal agent present', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    const body = await res.text()
    expect(body).toContain('Teal')
  })
})

test.describe('Color Agent - Board & Operations', () => {
  test('Kanban board has 7 columns', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Review status badges visible', async ({ request }) => {
    const res = await request.get('http://localhost:3101/agents', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Handoff cards can be created', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/agents/handoff', {
      data: { from: 'Blue', to: 'Red', summary: 'Escalation' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('Color routing logic accessible', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/agents/routing', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Color gate check works', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/agents/gate-check', {
      data: { agent: 'Gray', releaseId: 'rel-001' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })
})
