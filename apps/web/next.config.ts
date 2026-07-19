import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// U007: do not load monorepoRoot/.env or .env.local here (no dotenv override).
// Next still loads project-dir env via its own loadEnvConfig; isolation owner is
// the detached release mirror, not this config file.

const requestedDistDir = process.env.NEXT_DIST_DIR;
const distDir = requestedDistDir === undefined ? ".next" : path.normalize(requestedDistDir.trim());

if (
  distDir.length === 0 ||
  distDir === "." ||
  distDir === ".." ||
  path.isAbsolute(distDir) ||
  distDir.startsWith(`..${path.sep}`)
) {
  throw new TypeError("NEXT_DIST_DIR must be a non-empty directory relative to apps/web");
}

const nextConfig: NextConfig = {
  distDir,
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  transpilePackages: ["@sangfor/agent", "@sangfor/business", "@sangfor/db", "@sangfor/health", "@sangfor/infra", "@sangfor/shared"],
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
