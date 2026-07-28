import { test, expect, type APIRequestContext } from '@playwright/test'

// Core user-flow smoke test (plan §0-1): 로그인 → 포털 내비 → deals 목록/상세 →
// cfo 대시보드 → 메일 후보 목록. Mirrors the repo convention: runs against a
// live app server on :3101 (override with BASE_URL for an alternate port).
//
// Auth assumption (documented per plan §0-1): Phase S (not yet merged as of
// this writing) wires apps/web/src/proxy.ts into middleware.ts and makes
// JWT_SECRET an opt-in gate. proxy.ts's own logic is `isAuthConfigured() ?
// enforce : no-op` — when JWT_SECRET is unset the gate never engages, so an
// unauthenticated flow is expected to keep working today. When JWT_SECRET IS
// set, a real session (via AUTH_DEMO_PASSWORD) becomes required. This helper
// calls /api/auth/login either way and relies on Playwright's
// APIRequestContext persisting the returned `session` cookie across
// subsequent calls in the same test — but only *requires* login to succeed
// when JWT_SECRET is configured, so the spec passes unchanged pre- and
// post-Phase-S. (Known pre-existing gap, not introduced here: with JWT_SECRET
// unset, apps/web/src/lib/auth/session.ts's createSessionToken() still calls
// getJwtSecret() unconditionally and throws — so login itself 500s in today's
// "mock mode". That is harmless for this smoke spec only because proxy.ts's
// gate is a no-op in that same unconfigured state.)
const BASE = process.env.BASE_URL ?? 'http://localhost:3101'

async function login(request: APIRequestContext): Promise<string | null> {
  if (process.env.UX_AUTH_STORAGE_STATE_DIR?.trim()) return null
  const password = process.env.AUTH_DEMO_PASSWORD?.trim()
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: password ? { password } : {},
    timeout: 15000,
  })
  if (!res.ok()) {
    if (process.env.JWT_SECRET?.trim()) {
      throw new Error(`login failed with JWT_SECRET configured (status ${res.status()}) — auth is meant to be enforced here`)
    }
    return null
  }
  const body = await res.json()
  return (body.token as string) ?? null
}

test.describe('Core flow smoke', () => {
  test('login → portal nav → deals list/detail → cfo dashboard → mail candidates', async ({ request }) => {
    // 1. 로그인 (session fixture — cookie set by login() persists on `request`
    // for every call below, and Authorization header is also attached as a
    // belt-and-suspenders match for proxy.ts's cookie-or-bearer-token check).
    const token = await login(request)
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

    // 2. 포털 내비 — root redirects to /dashboard; both must render the portal shell.
    const home = await request.get(`${BASE}/`, { timeout: 15000, headers: authHeaders })
    expect(home.ok()).toBeTruthy()
    const homeBody = await home.text()
    expect(homeBody).toContain('AI 업무 포털')

    // 3. deals 목록
    const dealsList = await request.get(`${BASE}/deals`, { timeout: 15000, headers: authHeaders })
    expect(dealsList.ok()).toBeTruthy()

    // deals 상세 — resolve a real opportunity id via the API so the detail
    // page is exercised against actual data rather than a guessed id.
    const opportunities = await request.get(`${BASE}/api/opportunities`, { timeout: 15000, headers: authHeaders })
    expect(opportunities.ok()).toBeTruthy()
    const { opportunities: oppList } = await opportunities.json()
    expect(Array.isArray(oppList)).toBeTruthy()

    if (oppList.length > 0) {
      const dealDetail = await request.get(`${BASE}/deals/${oppList[0].id}`, { timeout: 15000, headers: authHeaders })
      expect(dealDetail.ok()).toBeTruthy()
    }

    // 4. cfo 대시보드
    const cfoDashboard = await request.get(`${BASE}/cfo/dashboard`, { timeout: 15000, headers: authHeaders })
    expect(cfoDashboard.ok()).toBeTruthy()

    // 5. 메일 후보 목록
    const mailCandidates = await request.get(`${BASE}/development/mail-candidates`, { timeout: 15000, headers: authHeaders })
    expect(mailCandidates.ok()).toBeTruthy()
  })
})
