import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { proxyFinanceRequest } from "@/lib/finance-proxy-handler";

export async function cfoFetch<T = unknown>(path: string): Promise<T> {
  const token = (await cookies()).get("session")?.value;
  if (!token) throw new Error("재무 데이터를 불러오지 못했습니다. (401)");

  const request = new NextRequest(
    `http://sangfor.local/api/finance/${path.replace(/^\//, "")}`,
    { headers: { cookie: `session=${encodeURIComponent(token)}` } },
  );
  const response = await proxyFinanceRequest(request, "GET");
  if (!response.ok) {
    console.error(`[cfoFetch] finance proxy ${response.status}`);
    throw new Error(`재무 데이터를 불러오지 못했습니다. (${response.status})`);
  }
  return response.json() as Promise<T>;
}
