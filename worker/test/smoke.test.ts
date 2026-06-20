import { describe, expect, it } from "vitest";

// Confirms the vitest-pool-workers toolchain boots against wrangler.jsonc.
// Replaced/expanded by real unit + integration tests in later steps.
describe("scaffold baseline", () => {
  it("runs inside the workers pool", () => {
    expect(1 + 1).toBe(2);
  });
});
