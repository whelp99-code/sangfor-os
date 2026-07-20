import { getUserJwtConfig, type UserJwtConfig } from "@sangfor/config";

export const AUTH_CONFIGURATION_UNAVAILABLE = "AUTH_CONFIGURATION_UNAVAILABLE" as const;

export function getWebSessionJwtConfig(): UserJwtConfig {
  return getUserJwtConfig();
}

export function isAuthConfigured(): boolean {
  try {
    getUserJwtConfig();
    return true;
  } catch {
    return false;
  }
}
