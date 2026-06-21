import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAthleteTools } from "../src/tools/athletes";
import { registerMessagingTools } from "../src/tools/messaging";
import { registerTeamTools } from "../src/tools/teams";
import { registerWorkoutTools } from "../src/tools/workout";
import type { ToolContext } from "../src/context";

type Handler = (
  args: Record<string, unknown>,
  extra: { requestId?: string },
) => Promise<{ isError?: boolean }>;

type Register = (server: McpServer, ctx: ToolContext) => void;

/** A fake McpServer that captures registered tool handlers and stubs elicitation. */
function harness(elicit: () => Promise<unknown>) {
  const handlers = new Map<string, Handler>();
  const server = {
    server: { elicitInput: elicit },
    registerTool: (name: string, _cfg: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  return { server, handlers };
}

function ctx(onRequest: () => void): ToolContext {
  const client = {
    request: async () => {
      onRequest();
      return { ok: true, status: 200, data: { done: true } };
    },
  };
  return { client, index: {} } as unknown as ToolContext;
}

const DECLINE = async () => ({ action: "decline" });
const UNAVAILABLE = async () => {
  throw new Error("client does not support elicitation");
};
const ACCEPT = async () => ({ action: "accept", content: { confirm: true } });

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

function run(
  reg: Register,
  name: string,
  elicit: () => Promise<unknown>,
  args: Record<string, unknown>,
) {
  let called = false;
  const { server, handlers } = harness(elicit);
  reg(
    server,
    ctx(() => {
      called = true;
    }),
  );
  const handler = handlers.get(name);
  expect(handler, `${name} should be registered`).toBeDefined();
  return { run: () => handler!(args, { requestId: "r1" }), called: () => called };
}

describe("every gated coach tool fails closed without confirmation", () => {
  for (const t of GATED) {
    it(`${t.name}: declined elicitation → blocked, no API call`, async () => {
      const probe = run(t.reg, t.name, DECLINE, t.args);
      const res = await probe.run();
      expect(res.isError, `${t.name} must be blocked`).toBe(true);
      expect(probe.called(), `${t.name} must not hit the API`).toBe(false);
    });

    it(`${t.name}: elicitation unavailable → blocked (fail closed)`, async () => {
      const probe = run(t.reg, t.name, UNAVAILABLE, t.args);
      const res = await probe.run();
      expect(res.isError, `${t.name} must fail closed`).toBe(true);
      expect(probe.called(), `${t.name} must not hit the API`).toBe(false);
    });

    it(`${t.name}: confirm:true opens the gate → API called (and never elicits)`, async () => {
      // The elicit stub throws if touched, proving confirm:true short-circuits elicitation.
      const probe = run(t.reg, t.name, UNAVAILABLE, { ...t.args, confirm: true });
      await probe.run();
      expect(probe.called(), `${t.name} should hit the API when confirmed`).toBe(true);
    });
  }
});

describe("accepted elicitation opens the gate", () => {
  it("athlete_archive calls the API once elicitation is accepted", async () => {
    const probe = run(registerAthleteTools, "athlete_archive", ACCEPT, { athleteIds: [123] });
    const res = await probe.run();
    expect(probe.called()).toBe(true);
    expect(res.isError).toBeUndefined();
  });
});
