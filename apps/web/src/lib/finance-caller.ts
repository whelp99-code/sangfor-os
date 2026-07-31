import { NextRequest } from "next/server";

import { proxyFinanceRequest } from "@/lib/finance-proxy-handler";

/**
 * Builds a finance caller bound to an incoming request's own credentials.
 *
 * `packages/business` reaches the CFO API through `finance/cfo-client`, which
 * sends the shared API key and nothing else. apps/api refuses that for finance
 * routes: `middleware/finance-access.ts` demands a signed FINANCE /
 * `human_delegation` internal principal. Only `proxyFinanceRequest` mints one,
 * and only from a verified session — which is why Hometax tax-invoice ingestion
 * inside mail-import failed with INTERNAL_PRINCIPAL_REQUIRED on every message.
 *
 * Routing the call back through the proxy keeps the authorization story
 * unchanged: the principal still delegates a real operator session that has
 * cleared the capability gate, exactly as the portal's own finance reads do. It
 * does not widen the boundary to admit a service subject.
 *
 * Both credential forms are forwarded because callers differ: the portal sends a
 * `session` cookie, the launchd cron sends a bearer token.
 */
export function financeCallerFor(request: Request) {
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");

  return async function callFinance<T>(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers();
    if (authorization) headers.set("authorization", authorization);
    if (cookie) headers.set("cookie", cookie);
    if (init?.body !== undefined) headers.set("content-type", "application/json");

    const proxied = new NextRequest(
      `http://sangfor.local/api/finance/${path.replace(/^\//, "")}`,
      { method, headers, ...(init?.body === undefined ? {} : { body: init.body }) },
    );

    const response = await proxyFinanceRequest(proxied, method);
    if (!response.ok) {
      // The upstream body can carry finance detail; keep it server-side.
      console.error(`[financeCaller] ${method} ${path} -> ${response.status}`);
      throw new Error(`finance call failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  };
}
