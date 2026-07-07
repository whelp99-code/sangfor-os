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
  transpilePackages: ["@sangfor/agent", "@sangfor/business", "@sangfor/db", "@sangfor/infra", "@sangfor/shared"],
  turbopack: {
    root: monorepoRoot,
  },
  async redirects() {
    return [
      { source: "/opportunities", destination: "/deals", permanent: false },
      { source: "/opportunities/:id", destination: "/deals/:id", permanent: false },
      { source: "/mail-intelligence", destination: "/inbox", permanent: false },
      { source: "/development/mail-candidates", destination: "/inbox?tab=candidates", permanent: false },
      { source: "/mail-connection", destination: "/settings/mail-connection", permanent: false },
    ];
  },
};

export default nextConfig;
