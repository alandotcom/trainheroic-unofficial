import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// vitest-pool-workers 0.16+ (vitest 4) uses the cloudflareTest plugin instead of
// the old defineWorkersConfig/poolOptions. Bindings, compatibility flags, and the
// DO/D1/KV setup are read from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Provide secrets for tests so they don't depend on a local .dev.vars file.
      miniflare: { bindings: { COOKIE_ENCRYPTION_KEY: "test-cookie-secret", ALLOWED_EMAILS: "" } },
    }),
  ],
});
