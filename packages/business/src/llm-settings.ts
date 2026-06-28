/**
 * Web-managed LLM credentials (OpenAI-compatible). OpenAI offers no OAuth for API
 * access, so the key is entered in the app Settings page and stored in the generic
 * config store (config_profiles/config_values) instead of editing `.env`.
 *
 * The existing getOpenAi* getters read process.env synchronously, so on each LLM
 * entry point we hydrate process.env from the DB (`loadLlmConfigFromDb`). Saving
 * also sets process.env immediately for the running process.
 */
import { type Prisma, prisma } from "@sangfor/db";

const PROFILE_KEY = "app-secrets";
const VALUE_KEY = "llm";

export interface LlmSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

async function readStored(): Promise<LlmSettings> {
  const profile = await prisma.configProfile.findUnique({
    where: { key: PROFILE_KEY },
    select: { values: { where: { key: VALUE_KEY }, select: { valueJson: true } } },
  });
  const raw = profile?.values[0]?.valueJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as LlmSettings;
  }
  return {};
}

/** Persist LLM settings and apply them to the running process immediately. */
export async function saveLlmSettings(input: LlmSettings): Promise<{ configured: boolean }> {
  const current = await readStored();
  // Empty string clears a field; undefined leaves it unchanged.
  const next: LlmSettings = {
    apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey.trim() || undefined,
    baseUrl: input.baseUrl === undefined ? current.baseUrl : input.baseUrl.trim() || undefined,
    model: input.model === undefined ? current.model : input.model.trim() || undefined,
  };

  const valueJson = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue;
  const profile = await prisma.configProfile.upsert({
    where: { key: PROFILE_KEY },
    update: {},
    create: { key: PROFILE_KEY },
  });
  await prisma.configValue.upsert({
    where: { profileId_key: { profileId: profile.id, key: VALUE_KEY } },
    update: { valueJson },
    create: { profileId: profile.id, key: VALUE_KEY, valueJson },
  });

  applyToEnv(next);
  return { configured: Boolean(next.apiKey) };
}

function applyToEnv(s: LlmSettings) {
  if (s.apiKey !== undefined) process.env.OPENAI_API_KEY = s.apiKey ?? "";
  if (s.baseUrl !== undefined) process.env.OPENAI_BASE_URL = s.baseUrl ?? "";
  if (s.model !== undefined) process.env.OPENAI_MODEL = s.model ?? "";
}

/**
 * Hydrate process.env from the DB so synchronous getOpenAi* getters see the
 * web-saved key. Env vars set in the actual environment take precedence (so an
 * ops-provided .env key is not overridden). Idempotent + cheap.
 */
export async function loadLlmConfigFromDb(): Promise<void> {
  const stored = await readStored();
  if (stored.apiKey && !process.env.OPENAI_API_KEY?.trim()) process.env.OPENAI_API_KEY = stored.apiKey;
  if (stored.baseUrl && !process.env.OPENAI_BASE_URL?.trim()) process.env.OPENAI_BASE_URL = stored.baseUrl;
  if (stored.model && !process.env.OPENAI_MODEL?.trim()) process.env.OPENAI_MODEL = stored.model;
}

/** Masked status for the settings UI — never returns the full key. */
export async function getLlmSettingsStatus(): Promise<{
  configured: boolean;
  source: "env" | "saved" | "none";
  keyMasked?: string;
  baseUrl?: string;
  model?: string;
}> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  const stored = await readStored();
  const key = envKey || stored.apiKey;
  const mask = (k?: string) => (k && k.length > 6 ? `${k.slice(0, 3)}…${k.slice(-4)}` : k ? "•••" : undefined);
  return {
    configured: Boolean(key),
    source: envKey ? "env" : stored.apiKey ? "saved" : "none",
    keyMasked: mask(key),
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || stored.baseUrl,
    model: process.env.OPENAI_MODEL?.trim() || stored.model || "gpt-4o-mini",
  };
}
