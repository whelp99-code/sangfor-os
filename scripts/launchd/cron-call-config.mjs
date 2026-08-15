export function resolveCronCallConfig(env = process.env) {
  return {
    webContainer: env.SANGFOR_WEB_CONTAINER || "sangfor-production-web-1",
    postgresContainer: env.SANGFOR_POSTGRES_CONTAINER || "sangfor-production-postgres-1",
    baseUrl: env.SANGFOR_BASE_URL || "https://aios.localhost",
  };
}

export function parseSessionTtlSeconds(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("USER_JWT_TTL_SECONDS must be a positive integer");
  }
  return parsed;
}

export function shouldDisableTlsVerification(baseUrl) {
  return new URL(baseUrl).hostname === "aios.localhost";
}
