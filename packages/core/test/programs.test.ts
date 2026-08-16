import { expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ClientResult } from "@trainheroic-unofficial/js";
import type { ToolContext } from "../src/context";
import { registerProgramTools } from "../src/tools/programs";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;

it("program_create returns normalized container and program ids", async () => {
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
      return {
        ok: true,
        status: 200,
        data: {
          id: 5038722,
          title: "Generated title",
          programId: 5074349,
          group_program: 5074349,
          type: 1,
          program: { id: 5074349, program_type: 1 },
        },
      };
    },
  } as unknown as ToolContext["client"];
  registerProgramTools(server, { client, index: {} } as unknown as ToolContext);

  const result = await handlers.get("program_create")!(
    { kind: "calendar", name: "Probe calendar" },
    {} as ServerContext,
  );

  expect(result.isError).not.toBe(true);
  expect(JSON.parse(result.content[0]?.text ?? "null")).toMatchObject({
    containerId: 5038722,
    programId: 5074349,
    kind: "calendar",
  });
  expect(requests).toEqual([
    {
      method: "POST",
      path: "/1.0/coach/programs/create",
      body: { finite: false, name: "Probe calendar" },
    },
  ]);
});
