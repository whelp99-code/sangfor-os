const DEFAULT_API = "http://127.0.0.1:3200/api/cfo";

function apiBase() {
  const raw = process.env.CFO_API_URL ?? process.env.FINANCE_API_URL ?? DEFAULT_API;
  return raw.replace("localhost", "127.0.0.1").replace(/\/$/, "");
}

export async function cfoFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${apiBase()}/${path.replace(/^\//, "")}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  const apiKey = process.env.FINANCE_API_KEY ?? process.env.API_KEY;
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    next: { revalidate: 0 },
  } as any);
  if (!res.ok) {
    const text = await res.text();
    console.error(`[cfoFetch] upstream ${res.status}:`, text);
    throw new Error(`재무 데이터를 불러오지 못했습니다. (${res.status})`);
  }
  return res.json() as Promise<T>;
}
