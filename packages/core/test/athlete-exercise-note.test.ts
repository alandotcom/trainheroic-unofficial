import { expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ClientResult } from "@trainheroic-unofficial/js";
import { registerAthleteTrainingTools } from "../src/tools/athlete-training";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;

const SWE_ID = 2809127408;

it("athlete_exercise_note PUTs the note on the saved exercise slot", async () => {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const client = {
    request: async (
      method: string,
      path: string,
      options?: { body?: unknown },
    ): Promise<ClientResult> => {
      requests.push({ method, path, body: options?.body });
      return { ok: true, status: 200, data: { id: SWE_ID, notes: "green band" } };
    },
  };
  registerAthleteTrainingTools(server, { client } as never);

  const result = await handlers.get("athlete_exercise_note")!(
    { savedWorkoutSetExerciseId: SWE_ID, notes: "green band", confirm: true },
    {} as ServerContext,
  );

  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
    savedWorkoutSetExerciseId: SWE_ID,
    notes: "green band",
  });
  expect(requests).toEqual([
    {
      method: "PUT",
      path: `/1.0/athlete/savedworkoutsetexercise/${SWE_ID}`,
      body: { id: SWE_ID, notes: "green band" },
    },
  ]);
});

it("athlete_exercise_note rejects a missing notes field", async () => {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const requests: Array<{ method: string; path: string }> = [];
  const client = {
    request: async (method: string, path: string): Promise<ClientResult> => {
      requests.push({ method, path });
      return { ok: true, status: 200, data: {} };
    },
  };
  registerAthleteTrainingTools(server, { client } as never);

  const result = await handlers.get("athlete_exercise_note")!(
    { savedWorkoutSetExerciseId: SWE_ID },
    {} as ServerContext,
  );

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toMatch(/notes/i);
  expect(requests).toEqual([]);
});
