import { NextResponse } from "next/server";
import { buildAuthorizationUrl, isOutlookOAuthConfigured } from "@/lib/outlook-graph";

// Kick off the delegated OAuth flow: set a CSRF state cookie and redirect the
// user to the Microsoft sign-in page.
export async function GET(request: Request) {
  if (!isOutlookOAuthConfigured()) {
    const dest = new URL("/mail-connection?error=not_configured", request.url);
    return NextResponse.redirect(dest);
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildAuthorizationUrl(state));
  response.cookies.set("outlook_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
