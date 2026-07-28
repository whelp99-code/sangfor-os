import { z } from "zod";

const localRuntimeSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]),
});

const localMockRuntimeSchema = localRuntimeSchema.extend({
  AUTH_PROFILE: z.literal("local_mock"),
});

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function isLocalTestRuntime(source: EnvironmentSource = process.env): boolean {
  return localRuntimeSchema.safeParse(source).success;
}

export function isLocalMockAuthProfile(source: EnvironmentSource = process.env): boolean {
  return localMockRuntimeSchema.safeParse(source).success;
}
