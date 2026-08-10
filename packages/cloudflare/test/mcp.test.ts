import { describe, expect, it } from "vitest";
import { buildServer, parseProps, selectSurfaces } from "../src/mcp";
import type { Props } from "../src/types";

// The (variant, role) matrix is this package's authorization boundary: it is what keeps the
// coaching surface away from an athlete account on the shared `/mcp` path. Nothing else pins it,
// so these tests are the enforcement.

const props = (role: string, thUserId = 1): Props =>
  ({ thUserId, email: "a@b.com", password: "pw", role, scope: "athlete" }) as Props;

/**
 * Which of `names` a variant registers for a role, probed through McpServer's public
 * `toolInputSchemaJson` (it returns `undefined` for a tool that was never registered). No
 * transport and no OAuth grant needed.
 */
function registeredAmong(
  variant: "full" | "coach" | "athlete",
  role: "coach" | "athlete",
  names: readonly string[],
): string[] {
  const server = buildServer(variant, props(role));
  return names.filter((name) => server.toolInputSchemaJson(name) !== undefined);
}

describe("selectSurfaces", () => {
  it("gives every account the athlete surface on /mcp and /mcp/athlete", () => {
    expect(selectSurfaces("full", "athlete").athlete).toBe(true);
    expect(selectSurfaces("full", "coach").athlete).toBe(true);
    expect(selectSurfaces("athlete", "athlete").athlete).toBe(true);
    expect(selectSurfaces("athlete", "coach").athlete).toBe(true);
  });

  it("gives the coach surface only to a coach account", () => {
    expect(selectSurfaces("full", "coach").coach).toBe(true);
    expect(selectSurfaces("coach", "coach").coach).toBe(true);
    expect(selectSurfaces("full", "athlete").coach).toBe(false);
    expect(selectSurfaces("coach", "athlete").coach).toBe(false);
  });

  it("never gives the coach surface on the athlete-scoped path", () => {
    expect(selectSurfaces("athlete", "coach").coach).toBe(false);
    expect(selectSurfaces("athlete", "athlete").coach).toBe(false);
  });
});

describe("buildServer tool surfaces", () => {
  const COACH_ONLY = ["list_athletes", "workout_publish", "team_delete", "message_send"] as const;
  const ATHLETE = ["athlete_workouts", "athlete_whoami"] as const;
  const ALL = [...COACH_ONLY, ...ATHLETE, "report_feedback"] as const;

  it("an athlete account on /mcp gets the athlete surface and no coaching tools", () => {
    expect(registeredAmong("full", "athlete", ALL).sort()).toEqual(
      [...ATHLETE, "report_feedback"].sort(),
    );
  });

  it("a coach account on /mcp gets both surfaces", () => {
    expect(registeredAmong("full", "coach", ALL).sort()).toEqual([...ALL].sort());
  });

  it("a coach account on /mcp/athlete still gets no coaching tools", () => {
    expect(registeredAmong("athlete", "coach", ALL).sort()).toEqual(
      [...ATHLETE, "report_feedback"].sort(),
    );
  });

  it("an athlete account on /mcp/coach gets only the cross-cutting tools", () => {
    expect(registeredAmong("coach", "athlete", ALL)).toEqual(["report_feedback"]);
  });

  it("registers the feedback reporter on every variant", () => {
    for (const variant of ["full", "coach", "athlete"] as const) {
      expect(registeredAmong(variant, "coach", ["report_feedback"])).toEqual(["report_feedback"]);
    }
  });
});

describe("parseProps", () => {
  const base = { thUserId: 1, email: "a@b.com", password: "pw", role: "coach", scope: "athlete" };

  it("accepts a well-formed grant", () => {
    expect(parseProps(base)?.role).toBe("coach");
  });

  it("normalizes a legacy grant whose role predates AccountRole", () => {
    // Grants issued before `toAccountRole` stored `data.role ?? ""` verbatim and are encrypted
    // per token, so they can never be migrated. They must degrade to `athlete`, not be rejected.
    expect(parseProps({ ...base, role: "" })?.role).toBe("athlete");
    expect(parseProps({ ...base, role: "USER" })?.role).toBe("athlete");
    expect(parseProps({ ...base, role: undefined })?.role).toBe("athlete");
  });

  it("rejects a grant missing a load-bearing field", () => {
    expect(parseProps(undefined)).toBeUndefined();
    expect(parseProps({ ...base, thUserId: "1" })).toBeUndefined();
    expect(parseProps({ ...base, email: "" })).toBeUndefined();
    expect(parseProps({ ...base, password: "" })).toBeUndefined();
  });

  it("rejects an invalid athlete tenant id", () => {
    expect(parseProps({ ...base, thUserId: 0 })).toBeUndefined();
    expect(parseProps({ ...base, thUserId: -1 })).toBeUndefined();
    expect(parseProps({ ...base, thUserId: 1.5 })).toBeUndefined();
    expect(parseProps({ ...base, thUserId: Number.MAX_SAFE_INTEGER + 1 })).toBeUndefined();
  });
});
