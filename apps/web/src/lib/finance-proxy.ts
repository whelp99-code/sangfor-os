const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:3200/api/cfo";

export function buildFinanceProxyUrl(pathname: string, search = "", baseUrl = FINANCE_API_URL) {
  const path = pathname.replace(/^\/api\/finance\/?/, "").replace(/^\/+/, "");
  return `${baseUrl.replace(/\/$/, "")}/${path}${search}`;
}
