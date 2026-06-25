import { test, expect } from '@playwright/test'

test.describe('Business API - Health', () => {
  test('Unified health returns 12 services', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/unified-health', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.services).toBeDefined()
  })
})

test.describe('Business API - tRPC', () => {
  test('Product families endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/trpc/productFamilies', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('SKUs endpoint', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/trpc/skus', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Quote calculation with margin', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/trpc/calculateQuote', {
      data: { sku: 'SKU-001', quantity: 10, margin: 0.25 },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('Vendor request creation', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/trpc/createVendorRequest', {
      data: { vendor: 'Acme Supplies', items: ['SKU-001'] },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('AI quality evaluation', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/trpc/evaluateQuality', {
      data: { pocId: 'poc-001', criteria: ['functionality', 'performance'] },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('Color agent routing tRPC', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/trpc/colorAgentRoute', {
      data: { opportunityId: 'opp-001', currentStage: 'Qualified' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('Release gate check tRPC', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/trpc/releaseGateCheck', {
      data: { releaseId: 'rel-001' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })
})

test.describe('Business API - Metrics & Webhooks', () => {
  test('API metrics in Prometheus format', async ({ request }) => {
    const res = await request.get('http://localhost:3200/api/metrics', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Webhook outlook GET', async ({ request }) => {
    const res = await request.get('http://localhost:3200/webhooks/outlook', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Webhook outlook POST', async ({ request }) => {
    const res = await request.post('http://localhost:3200/webhooks/outlook', {
      data: { event: 'meeting.created', subject: 'Test' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })
})

test.describe('Business API - Settings CRUD', () => {
  test('Settings read', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/settings', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Settings create', async ({ request }) => {
    const res = await request.post('http://localhost:3101/api/settings', {
      data: { key: 'test_key', value: 'test_val' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })

  test('Settings update', async ({ request }) => {
    const res = await request.put('http://localhost:3101/api/settings', {
      data: { key: 'test_key', value: 'updated_val' },
      timeout: 10000,
    })
    expect(res.status()).toBe(200)
  })
})
