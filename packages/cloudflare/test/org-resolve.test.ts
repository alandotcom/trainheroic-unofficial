import { describe, expect, it } from "vitest";
import { resolveOrgId } from "../src/store/d1";

type Request = Parameters<typeof resolveOrgId>[0];

function reply(result: { ok: boolean; data: unknown }): Request {
  return async () => result;
}

// The tenant key must never silently become a real-looking id (0) on failure, or two
// tenants would collapse onto one shared partition. resolveOrgId throws instead.
describe("resolveOrgId", () => {
  it("returns the org_id from /user/simple", async () => {
    expect(await resolveOrgId(reply({ ok: true, data: { org_id: 42 } }))).toBe(42);
  });

  it("coerces a numeric-string org_id", async () => {
    expect(await resolveOrgId(reply({ ok: true, data: { org_id: "42" } }))).toBe(42);
  });

  it("throws when /user/simple is not ok (never collapses to 0)", async () => {
    await expect(resolveOrgId(reply({ ok: false, data: "boom" }))).rejects.toThrow();
  });

  it("throws when org_id is missing", async () => {
    await expect(resolveOrgId(reply({ ok: true, data: { name: "Coach" } }))).rejects.toThrow();
  });

  it("throws when org_id is zero or negative", async () => {
    await expect(resolveOrgId(reply({ ok: true, data: { org_id: 0 } }))).rejects.toThrow();
    await expect(resolveOrgId(reply({ ok: true, data: { org_id: -5 } }))).rejects.toThrow();
  });
});
