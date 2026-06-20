import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Provide secrets for tests so they don't depend on a local .dev.vars file.
      miniflare: { bindings: { COOKIE_ENCRYPTION_KEY: "test-cookie-secret", ALLOWED_EMAILS: "" } },
    }),
  ],
});
