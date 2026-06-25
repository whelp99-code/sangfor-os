/** Shared JWT auth gate — safe for Edge middleware and Node routes. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      "FATAL: JWT_SECRET is missing or too short (min 16 chars). " +
        "The app refuses to start without a valid secret.",
    );
  }
  return secret;
}

export function isAuthConfigured(): boolean {
  try {
    return Boolean(getJwtSecret());
  } catch {
    return false;
  }
}
