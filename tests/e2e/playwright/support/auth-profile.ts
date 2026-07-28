import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import type { BusinessRole } from "./ux-route-manifest";

type StorageState = {
  cookies?: Parameters<BrowserContext["addCookies"]>[0];
};

export async function installAuthProfile(
  context: BrowserContext,
  profile: BusinessRole | "anonymous",
): Promise<void> {
  await context.clearCookies();
  if (profile === "anonymous") return;

  const directory = process.env.UX_AUTH_STORAGE_STATE_DIR?.trim();
  if (!directory) throw new Error("UX_AUTH_STORAGE_STATE_DIR is required for authenticated UX tests");
  const state = JSON.parse(
    readFileSync(resolve(directory, `${profile}.json`), "utf8"),
  ) as StorageState;
  if (!state.cookies?.length) throw new Error(`AUTH_PROFILE_EMPTY:${profile}`);
  await context.addCookies(state.cookies);
}

export function authorizationHeadersForProfile(
  profile: BusinessRole,
): { Authorization: string } {
  const directory = process.env.UX_AUTH_STORAGE_STATE_DIR?.trim();
  if (!directory) throw new Error("UX_AUTH_STORAGE_STATE_DIR is required for authenticated API tests");
  const state = JSON.parse(
    readFileSync(resolve(directory, `${profile}.json`), "utf8"),
  ) as StorageState;
  const token = state.cookies?.find((cookie) => cookie.name === "session")?.value;
  if (!token) throw new Error(`AUTH_PROFILE_EMPTY:${profile}`);
  return { Authorization: `Bearer ${token}` };
}
