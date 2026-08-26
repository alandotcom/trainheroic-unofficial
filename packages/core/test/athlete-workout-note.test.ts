import { expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ClientResult } from "@trainheroic-unofficial/js";
import { registerAthleteTrainingTools } from "../src/tools/athlete-training";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;

const DATE = "2026-06-21";
const PW_ID = 12345;
const SAVED_ID = 8000;

it("athlete_workout_note PUTs the note after resolving the saved workout", async () => {
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
      if (path.includes("/athlete/programworkout/range")) {
        return {
          ok: true,
          status: 200,
          data: [
            {
              id: PW_ID,
              date: DATE,
              summarizedSavedWorkout: { saved_workout: { id: SAVED_ID, notes: "", rpe: null } },
            },
          ],
        };
      }
      return { ok: true, status: 200, data: { id: SAVED_ID, notes: "felt strong", rpe: 7 } };
    },
  };
  registerAthleteTrainingTools(server, { client } as never);

  const result = await handlers.get("athlete_workout_note")!(
    { date: DATE, programWorkoutId: PW_ID, notes: "felt strong", rpe: 7, confirm: true },
    {} as ServerContext,
  );

  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content[0]?.text ?? "null")).toMatchObject({
    programWorkoutId: PW_ID,
    savedWorkoutId: SAVED_ID,
    notes: "felt strong",
    rpe: 7,
  });
  expect(requests).toContainEqual({
    method: "PUT",
    path: `/1.0/athlete/savedworkout/${SAVED_ID}`,
    body: { id: SAVED_ID, notes: "felt strong", rpe: 7 },
  });
});

it("athlete_workout_note rejects neither-notes-nor-rpe with the dto message", async () => {
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

  const result = await handlers.get("athlete_workout_note")!(
    { date: DATE, programWorkoutId: PW_ID },
    {} as ServerContext,
  );

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toMatch(/Provide notes and\/or rpe/);
  expect(requests).toEqual([]);
});
