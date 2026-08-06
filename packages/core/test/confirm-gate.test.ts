import { describe, expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { isInputRequiredResult } from "@modelcontextprotocol/server";
import { registerAthleteTools } from "../src/tools/athletes";
import { registerMessagingTools } from "../src/tools/messaging";
import { registerTeamTools } from "../src/tools/teams";
import { registerWorkoutTools } from "../src/tools/workout";
import type { ToolContext } from "../src/context";

type Handler = (
  args: Record<string, unknown>,
  ctx: ServerContext,
) => Promise<{ isError?: boolean } | unknown>;

type Register = (server: McpServer, ctx: ToolContext) => void;

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

// Every gated coach tool, with the minimal args that reach the confirmGate call. The gate is
// the first network-touching step in each handler, so a blocked call never reaches the API.
const GATED: Array<{ reg: Register; name: string; args: Record<string, unknown> }> = [
  { reg: registerAthleteTools, name: "athlete_invite", args: { teamId: 1, emails: ["a@b.com"] } },
  { reg: registerAthleteTools, name: "athlete_archive", args: { athleteIds: [1] } },
  { reg: registerTeamTools, name: "team_delete", args: { teamId: 1 } },
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
];

function run(reg: Register, name: string, args: Record<string, unknown>) {
  let called = false;
  const { server, handlers } = harness();
  reg(
    server,
    toolCtx(() => {
      called = true;
    }),
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
