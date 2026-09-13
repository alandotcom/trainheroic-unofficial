import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Provide secrets for tests so they don't depend on a local .dev.vars file.
      miniflare: {
        bindings: { COOKIE_ENCRYPTION_KEY: "test-cookie-secret", ALLOWED_EMAILS: "" },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (!["api.trainheroic.com", "apis.trainheroic.com"].includes(url.hostname)) {
            throw new Error(`Unexpected unmocked outbound request to ${url.origin}${url.pathname}`);
          }
          if (url.pathname === "/auth") {
            return Response.json({ id: 204398, session_id: "fresh-session" });
          }
          if (!url.pathname.startsWith("/__coordinator_test/")) {
            throw new Error(`Unexpected unmocked outbound request to ${url.origin}${url.pathname}`);
          }
          if (
            url.pathname.startsWith("/__coordinator_test/relogin/") &&
            request.headers.get("session-token") === "stale-session"
          ) {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("expired"));
              },
            });
            return new Response(body, { status: 401 });
          }
          const startedAt = Date.now();
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
          });
          return Response.json({ startedAt, endedAt: Date.now(), path: url.pathname });
        },
      },
    }),
  ],
});
