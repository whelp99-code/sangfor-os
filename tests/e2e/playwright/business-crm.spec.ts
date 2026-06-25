import { test, expect } from '@playwright/test'

test.describe('CRM - Customers', () => {
  test('Customers list loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/customers', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Customer create page loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/customers/new', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Customer detail loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/customers/cust-001', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})

test.describe('CRM - Opportunities', () => {
  test('Opportunities list loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/opportunities', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Pipeline board loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/opportunities/pipeline', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Stage advancement form loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/opportunities/opp-001/advance', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})

test.describe('CRM - PoC', () => {
  test('PoC list loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/pocs', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('PoC create page loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/pocs/new', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('PoC detail with checklist loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/pocs/poc-001', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})

test.describe('CRM - Proposals', () => {
  test('Proposals list loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/proposals', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Proposal generation page loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/proposals/generate', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})

test.describe('CRM - Tasks & Knowledge', () => {
  test('Tasks kanban board loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/tasks', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })

  test('Knowledge base search loads', async ({ request }) => {
    const res = await request.get('http://localhost:3101/knowledge', { timeout: 10000 })
    expect(res.ok()).toBeTruthy()
  })
})
