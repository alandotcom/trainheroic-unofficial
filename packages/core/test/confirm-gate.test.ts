import { describe, expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import { registerAthleteTrainingTools } from "../src/tools/athlete-training";
import { registerAthleteTools } from "../src/tools/athletes";
import { registerMessagingTools } from "../src/tools/messaging";
import { registerTeamTools } from "../src/tools/teams";
import { registerWorkoutTools } from "../src/tools/workout";
import type { ToolContext } from "../src/context";

type Handler = (
  args: Record<string, unknown>,
  ctx: ServerContext,
) => Promise<{ isError?: boolean } | unknown>;

/**
 * Coach registrars take the full `ToolContext`; the athlete-training registrar takes only
 * `{ client }`. The fake context below satisfies both, so one table can cover every gated tool.
 */
type Register = (server: McpServer, ctx: never) => void;

/** A fake McpServer that captures registered tool handlers. */
function harness() {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  return { server, handlers };
}

function toolCtx(onRequest: () => void): ToolContext {
  const client = {
    request: async () => {
      onRequest();
      return { ok: true, status: 200, data: { done: true } };
    },
  };
  return { client, index: {} } as unknown as ToolContext;
}

function mcpCtx(inputResponses?: Record<string, unknown>): ServerContext {
  return { mcpReq: { inputResponses } } as unknown as ServerContext;
}

const GATED: Array<{ reg: Register; name: string; args: Record<string, unknown> }> = [
  { reg: registerAthleteTools, name: "athlete_invite", args: { teamId: 1, emails: ["a@b.com"] } },
  { reg: registerAthleteTools, name: "athlete_archive", args: { athleteIds: [1] } },
  { reg: registerTeamTools, name: "team_delete", args: { teamId: 1 } },
  {
    reg: registerTeamTools,
    name: "team_update",
    args: { teamId: 1, title: "Team", groupProgram: 2 },
  },
  { reg: registerTeamTools, name: "team_code_delete", args: { codeId: 1 } },
  { reg: registerMessagingTools, name: "message_send", args: { streamId: 1, text: "hi" } },
  { reg: registerMessagingTools, name: "message_delete", args: { streamId: 1, commentId: 2 } },
  {
    reg: registerWorkoutTools,
    name: "workout_publish",
    args: { programId: 1, date: "2026-06-21", pwId: 2 },
  },
  { reg: registerWorkoutTools, name: "session_remove", args: { programId: 1, pwId: 2 } },
  { reg: registerWorkoutTools, name: "session_unpublish", args: { pwId: 2 } },
  // Coach writes into an athlete's own log / prescription.
  {
    reg: registerAthleteTools,
    name: "log_athlete_set",
    args: { athleteId: 1, date: "2026-06-21", savedWorkoutSetId: 2, results: [] },
  },
  {
    reg: registerAthleteTools,
    name: "coach_log_session",
    args: { athleteId: 1, date: "2026-06-21", exercises: [{ exerciseId: 3, sets: [{ reps: 5 }] }] },
  },
  {
    reg: registerAthleteTools,
    name: "swap_athlete_exercise",
    args: { savedWorkoutSetExerciseId: 1, exerciseId: 2 },
  },
  {
    reg: registerAthleteTools,
    name: "prescribe_athlete_set",
    args: { athleteId: 1, date: "2026-06-21", savedWorkoutSetId: 2, results: [] },
  },
  // The athlete surface is registered for EVERY hosted account, so an ungated write here is
  // reachable by every user — these gates matter most.
  {
    reg: registerAthleteTrainingTools,
    name: "athlete_session_remove",
    args: { programWorkoutId: 1, date: "2026-06-21" },
  },
  {
    reg: registerAthleteTrainingTools,
    name: "athlete_log_session",
    args: { date: "2026-06-21", exercises: [{ exerciseId: 3, sets: [{ reps: 5 }] }] },
  },
  {
    reg: registerAthleteTrainingTools,
    name: "athlete_log_set",
    args: { date: "2026-06-21", savedWorkoutSetId: 2, results: [] },
  },
  {
    reg: registerAthleteTrainingTools,
    name: "athlete_prescribe_set",
    args: { date: "2026-06-21", savedWorkoutSetId: 2, results: [] },
  },
  {
    reg: registerAthleteTrainingTools,
    name: "athlete_swap_exercise",
    args: { savedWorkoutSetExerciseId: 1, exerciseId: 2 },
  },
];

function run(reg: Register, name: string, args: Record<string, unknown>) {
  let called = false;
  const { server, handlers } = harness();
  reg(
    server,
    toolCtx(() => {
      called = true;
    }) as never,
  );
  const handler = handlers.get(name);
  expect(handler, `${name} should be registered`).toBeDefined();
  return {
    run: (ctx: ServerContext) => handler!(args, ctx),
    called: () => called,
  };
}

describe("every gated coach tool fails closed without confirmation", () => {
  for (const t of GATED) {
    it(`${t.name}: declined elicitation → blocked, no API call`, async () => {
      const probe = run(t.reg, t.name, t.args);
      const res = await probe.run(mcpCtx({ confirm: { action: "decline" } }));
      expect((res as { isError?: boolean }).isError, `${t.name} must be blocked`).toBe(true);
      expect(probe.called(), `${t.name} must not hit the API`).toBe(false);
    });

    it(`${t.name}: no confirm → needs_input (MRTR), no API call`, async () => {
      const probe = run(t.reg, t.name, t.args);
      const res = await probe.run(mcpCtx());
      expect(isInputRequiredResult(res), `${t.name} must request input`).toBe(true);
      expect(probe.called(), `${t.name} must not hit the API`).toBe(false);
    });

    it(`${t.name}: confirm:true opens the gate → API called`, async () => {
      const probe = run(t.reg, t.name, { ...t.args, confirm: true });
      await probe.run(mcpCtx());
      expect(probe.called(), `${t.name} should hit the API when confirmed`).toBe(true);
    });
  }
});

describe("accepted elicitation opens the gate", () => {
  it("athlete_archive calls the API once elicitation is accepted", async () => {
    const probe = run(registerAthleteTools, "athlete_archive", { athleteIds: [123] });
    const res = await probe.run(
      mcpCtx({ confirm: { action: "accept", content: { confirm: true } } }),
    );
    expect(probe.called()).toBe(true);
    expect((res as { isError?: boolean }).isError).toBeUndefined();
  });
});

describe("team_update conditional confirmation", () => {
  it("keeps title-only renames ungated", async () => {
    const probe = run(registerTeamTools, "team_update", { teamId: 1, title: "Renamed" });
    await probe.run(mcpCtx());
    expect(probe.called()).toBe(true);
  });
});
