const DEFAULT_API = "http://127.0.0.1:4100/api";

function apiBase() {
  const raw = process.env.CFO_API_URL ?? DEFAULT_API;
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
  if (process.env.API_KEY) {
    headers["X-API-Key"] = process.env.API_KEY;
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CFO API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function formatKrw(n: number) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
