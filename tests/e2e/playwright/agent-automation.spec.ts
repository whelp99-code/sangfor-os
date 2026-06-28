import { test, expect } from '@playwright/test'

// E2E for the MCP integration + agent automation surface.
// Mirrors the repo convention: runs against a live dev server on :3101.
const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

test.describe('Agent automation - pages load', () => {
  const pages = ['/agent-console', '/knowledge-search', '/tools', '/operator', '/settings']
  pages.forEach((p) => {
    test(`Page ${p} loads`, async ({ request }) => {
      const res = await request.get(`${BASE}${p}`, { timeout: 15000 })
      expect(res.ok()).toBeTruthy()
    })
  })
})

test.describe('Agent automation - APIs', () => {
  test('integrations health returns overall + targets', async ({ request }) => {
    const res = await request.get(`${BASE}/api/integrations/health`, { timeout: 15000 })
    const body = await res.json()
    expect(body.overall).toBeDefined()
    expect(Array.isArray(body.targets)).toBeTruthy()
  })

  test('integrations history returns a targets array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/integrations/history`, { timeout: 15000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.targets)).toBeTruthy()
  })

  test('agent playbooks are seeded', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agent/playbooks`, { timeout: 15000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(Array.isArray(body.playbooks)).toBeTruthy()
    expect(body.playbooks.length).toBeGreaterThan(0)
  })

  test('agent run rejects an empty goal', async ({ request }) => {
    const res = await request.post(`${BASE}/api/agent/run`, { data: { goal: '' }, timeout: 15000 })
    expect(res.status()).toBe(400)
  })
})
