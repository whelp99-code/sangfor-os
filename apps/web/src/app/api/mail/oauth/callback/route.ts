import { type NextRequest, NextResponse } from "next/server";
import { connectOutlookAccount, exchangeCodeForToken } from "@/lib/outlook-graph";

// Microsoft redirects here with ?code & ?state. Validate state, exchange the code
// for tokens, persist them on the MailAccount, then return to the connection page.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const dest = new URL("/mail-connection", request.url);

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
    dest.searchParams.set("error", error instanceof Error ? error.message : "oauth_failed");
  }

  const res = NextResponse.redirect(dest);
  res.cookies.delete("outlook_oauth_state");
  return res;
}
