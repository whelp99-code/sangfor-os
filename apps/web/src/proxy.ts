import { isAuthConfigured } from "@/lib/auth/config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/api/health", "/api/auth/login"];

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyEdgeSessionToken(token: string | null | undefined, secret: string) {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return base64UrlEncode(signed) === sig;
}

export async function proxy(request: NextRequest) {
  const secret = isAuthConfigured() ? process.env.JWT_SECRET!.trim() : null;
  if (secret) {
    const isPublic = PUBLIC_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
    if (!isPublic && request.nextUrl.pathname.startsWith("/api/")) {
      const token =
        request.cookies.get("session")?.value ??
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!(await verifyEdgeSessionToken(token, secret))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
