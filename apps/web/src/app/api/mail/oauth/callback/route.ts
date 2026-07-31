import { type NextRequest, NextResponse } from "next/server";
import { connectOutlookAccount, exchangeCodeForToken } from "@/lib/outlook";

// Microsoft redirects here with ?code & ?state. Validate state, exchange the code
// for tokens, persist them on the MailAccount, then return to the connection page.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Behind Caddy the container listens on HOSTNAME=0.0.0.0, so `request.url`
  // carries that internal origin. Building the redirect from it sent the
  // browser to http://0.0.0.0:3101 — an unreachable address — even though the
  // token exchange had already succeeded, so a working connection looked like
  // a failed one. Prefer the configured public origin; a forwarded header
  // would be client-controlled, which is the wrong thing to trust for a
  // redirect target.
  const dest = new URL("/settings/mail-connection", process.env.NEXT_PUBLIC_APP_URL || request.url);

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    dest.searchParams.set("error", url.searchParams.get("error_description") || oauthError);
    return NextResponse.redirect(dest);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("outlook_oauth_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    dest.searchParams.set("error", "invalid_state");
    const res = NextResponse.redirect(dest);
    res.cookies.delete("outlook_oauth_state");
    return res;
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    const account = await connectOutlookAccount(tokens);
    dest.searchParams.set("connected", account.email);
  } catch (error) {
    // Sanitize: log the real cause server-side; surface only a stable code in the
    // redirect URL (raw error.message can leak token-exchange / upstream detail).
    console.error("[api] oauth_callback_failed:", error);
    dest.searchParams.set("error", "oauth_failed");
  }

  const res = NextResponse.redirect(dest);
  res.cookies.delete("outlook_oauth_state");
  return res;
}
