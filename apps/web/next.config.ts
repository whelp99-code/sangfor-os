import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// Load repo-root .env so `pnpm dev` / `next start` from apps/web see DATABASE_URL.
loadEnv({ path: path.join(monorepoRoot, ".env") });
loadEnv({ path: path.join(monorepoRoot, ".env.local"), override: true });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@sangfor/business", "@sangfor/db", "@sangfor/shared"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
