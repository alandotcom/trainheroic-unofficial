import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { toolOutputSchemaFor } from "@trainheroic-unofficial/dto";
import { buildServer, parseProps, selectSurfaces } from "../src/mcp";
import { hostedWarehouseOutputSchemas } from "../src/tool-contracts";
import type { Props } from "../src/types";

// The (variant, role) matrix is this package's authorization boundary: it is what keeps the
// coaching surface away from an athlete account on the shared `/mcp` path. Nothing else pins it,
// so these tests are the enforcement.

const props = (role: string, thUserId = 1): Props =>
  ({ thUserId, email: "a@b.com", password: "pw", role, scope: "athlete" }) as Props;

const EXPECTED_HOSTED_COACH_TOOLS = [
  "analytics_categories",
  "analytics_query",
  "athlete_archive",
  "athlete_circuits",
  "athlete_exercise_history",
  "athlete_exercise_stats",
  "athlete_exercises",
  "athlete_invite",
  "athlete_leaderboard",
  "athlete_lift_history",
  "athlete_log_session",
  "athlete_log_set",
  "athlete_log_targets",
  "athlete_main_lift_prs",
  "athlete_personal_records",
  "athlete_prefs",
  "athlete_prescribe_set",
  "athlete_profile",
  "athlete_programming_programs",
  "athlete_recent_exercises",
  "athlete_restore",
  "athlete_saved_workouts",
  "athlete_session_add_exercises",
  "athlete_session_create",
  "athlete_session_remove",
  "athlete_swap_exercise",
  "athlete_training",
  "athlete_training_stored",
  "athlete_training_sync",
  "athlete_whoami",
  "athlete_working_maxes",
  "athlete_workouts",
  "athlete_workouts_stored",
  "athlete_workouts_sync",
  "coach_athlete_team_calendar",
  "coach_log_session",
  "exercise_create",
  "exercise_delete",
  "exercise_forget",
  "exercise_get",
  "exercise_resolve",
  "exercise_search",
  "exercise_sync",
  "exercise_update",
  "get_program",
  "get_team",
  "head_coach",
  "list_athletes",
  "list_notifications",
  "list_prescription_templates",
  "list_programs",
  "list_session_templates",
  "list_subscriptions",
  "list_team_codes",
  "list_teams",
  "log_athlete_set",
  "message_delete",
  "message_draft",
  "message_send",
  "messaging_conversations",
  "messaging_read",
  "messaging_stored",
  "messaging_sync",
  "notifications",
  "prescribe_athlete_set",
  "program_create",
  "program_delete",
  "programming_stored",
  "programming_sync",
  "report_feedback",
  "roster_activity",
  "roster_main_lift_prs",
  "session_copy",
  "session_remove",
  "session_save_as_template",
  "session_template_create",
  "session_template_delete",
  "session_unpublish",
  "store_stats",
  "swap_athlete_exercise",
  "team_code_create",
  "team_code_delete",
  "team_create",
  "team_delete",
  "team_publish_settings",
  "team_update",
  "team_volume",
  "whoami",
  "workout_build",
  "workout_publish",
  "workout_read",
] as const;

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

async function listTools(server: ReturnType<typeof buildServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "metadata-test", version: "1.0.0" });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
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

  it("registers complete output metadata for every hosted coach tool", async () => {
    const server = buildServer("full", props("coach"));
    const tools = await listTools(server);

    expect(tools).toHaveLength(91);
    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_HOSTED_COACH_TOOLS);
    for (const tool of tools) {
      const name = tool.name;
      expect(tool.annotations, `${name} annotations`).toEqual(
        expect.objectContaining({
          readOnlyHint: expect.any(Boolean),
          openWorldHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
        }),
      );
      expect(tool.outputSchema, `${name} outputSchema`).toBeDefined();
    }
  });

  it("validates representative bounded results against their registered output schemas", () => {
    const cases: Array<[string, { safeParse(value: unknown): { success: boolean } }, unknown]> = [
      ["whoami", toolOutputSchemaFor("whoami"), { id: 7, roles: ["coach"] }],
      ["athlete_profile", toolOutputSchemaFor("athlete_profile"), { summary: {}, user: { id: 7 } }],
      [
        "athlete_workouts",
        toolOutputSchemaFor("athlete_workouts"),
        [
          {
            id: 4,
            date: "2026-08-18",
            title: "Heavy day",
            program: "Strength",
            team: null,
            logged: true,
            personal: false,
            exerciseCount: 3,
            performedCount: 2,
          },
        ],
      ],
      [
        "athlete_workouts_sync",
        hostedWarehouseOutputSchemas.athlete_workouts_sync,
        { workouts: 4, exercises: 12, from: "2026-08-01", to: "2026-08-18" },
      ],
      [
        "messaging_stored",
        hostedWarehouseOutputSchemas.messaging_stored,
        [
          {
            id: 3,
            ts: 10,
            content: "hello",
            author_name: "Coach",
            is_author: 1,
            parent_id: null,
            reactions: [],
          },
        ],
      ],
      [
        "program_create",
        toolOutputSchemaFor("program_create"),
        {
          containerId: 1,
          programId: 2,
          title: "Base",
          kind: "calendar",
          requestedName: "Base",
          nameApplied: true,
        },
      ],
      ["message_delete", toolOutputSchemaFor("message_delete"), { deleted: true, response: {} }],
      [
        "report_feedback",
        toolOutputSchemaFor("report_feedback"),
        { status: "sent", reference: "abc", note: "Recorded." },
      ],
      [
        "athlete_profile",
        toolOutputSchemaFor("athlete_profile"),
        {
          preview: "partial",
          __truncated: { total: 100, omitted: 93, hint: "narrow the request" },
        },
      ],
      [
        "team_volume truncated",
        toolOutputSchemaFor("team_volume"),
        {
          window: { start: "2026-01-01", end: "2026-01-31" },
          athletes: [
            {
              athleteId: 1,
              name: "A",
              sessions: 1,
              reps: 1,
              volume: 1,
              firstLoggedDate: null,
              lastLoggedDate: null,
            },
          ],
          totals: { athletes: 50, sessions: 200, reps: 1, volume: 1 },
          __truncated: {
            field: "athletes",
            returned: 1,
            total: 50,
            omitted: 49,
            hint: "narrow the request",
          },
        },
      ],
    ];

    for (const [name, schema, output] of cases) {
      const parsed = schema.safeParse(output);
      expect(parsed.success, name).toBe(true);
      if (
        parsed.success &&
        typeof output === "object" &&
        output !== null &&
        "__truncated" in output
      ) {
        expect(parsed.data, name).toEqual(output);
      }
    }
  });

  it("uses review-accurate hints for reads, private syncs, and overwrites", async () => {
    const server = buildServer("full", props("coach"));
    const tools = new Map((await listTools(server)).map((tool) => [tool.name, tool]));

    expect(tools.get("athlete_workouts")?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(tools.get("programming_sync")?.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
    for (const name of ["exercise_forget", "team_update", "exercise_update", "report_feedback"]) {
      expect(tools.get(name)?.annotations?.destructiveHint, name).toBe(true);
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
