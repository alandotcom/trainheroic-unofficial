/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "cloudflare:test" {
  // Bindings available to tests come from wrangler.jsonc.
  interface ProvidedEnv extends Env {}
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}
