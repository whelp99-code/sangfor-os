import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APPROVAL_ISSUER: "sangfor.production-approval",
          NONCE_CONSUME_BEARER_TOKEN: "test-only-nonce-consume-token-0123456789abcdef",
        },
      },
    }),
  ],
});
