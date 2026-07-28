const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:3200/api/cfo";

/** The finance proxy signs this normalized body, then sends the identical bytes upstream. */
export function normalizeFinanceProxyBody(body: unknown): string {
  return JSON.stringify(body);
}

export function buildFinanceProxyUrl(pathname: string, search = "", baseUrl = FINANCE_API_URL) {
  const path = pathname.replace(/^\/api\/finance\/?/, "").replace(/^\/+/, "");
  return `${baseUrl.replace(/\/$/, "")}/${path}${search}`;
}
