import { describe, expect, it } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ClientResult } from "@trainheroic-unofficial/js";
import type { ToolContext } from "../src/context";
import { registerReadTools } from "../src/tools/reads";

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
type Handler = (args: Record<string, unknown>, ctx: ServerContext) => Promise<ToolResult>;
type Request = (method: string, path: string) => Promise<ClientResult>;

function getProgramHandler(request: Request): Handler {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler),
  } as unknown as McpServer;
  const client = { request } as unknown as ToolContext["client"];
  registerReadTools(server, { client, index: {} } as unknown as ToolContext);
  const handler = handlers.get("get_program");
  expect(handler).toBeDefined();
  return handler!;
}

describe("get_program", () => {
  it("returns nested detail when the program-detail endpoint supports the calendar", async () => {
    const handler = getProgramHandler(async (_method, path) => {
      if (path === "/3.0/coach/program/42") {
        return { ok: true, status: 200, data: { id: 42, blocks: [{ id: 7 }] } };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await handler({ programId: 42 }, {} as ServerContext);

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
      id: 42,
      blocks: [{ id: 7 }],
    });
  });

  it("follows a standalone container id to its real program id", async () => {
    const handler = getProgramHandler(async (_method, path) => {
      if (path === "/3.0/coach/program/4864050") {
        return { ok: false, status: 401, data: "Cannot access program" };
      }
      if (path === "/1.0/coach/programs") {
        return {
          ok: true,
          status: 200,
          data: [{ id: 4864050, group_program: 4864999, title: "Coach Plan" }],
        };
      }
      if (path === "/3.0/coach/program/4864999") {
        return { ok: true, status: 200, data: { id: 4864999, group_id: 4864050, type: 1 } };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await handler({ programId: 4864050 }, {} as ServerContext);

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
      id: 4864999,
      group_id: 4864050,
      type: 1,
    });
  });

  it("returns limited metadata when the standalone program id also rejects detail", async () => {
    const handler = getProgramHandler(async (_method, path) => {
      if (path === "/3.0/coach/program/4864050" || path === "/3.0/coach/program/4864999") {
        return { ok: false, status: 401, data: "Cannot access program" };
      }
      if (path === "/1.0/coach/programs") {
        return {
          ok: true,
          status: 200,
          data: [{ id: 4864050, group_program: 4864999, title: "Coach Plan" }],
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await handler({ programId: 4864050 }, {} as ServerContext);
    const body = JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;

    expect(result.isError).not.toBe(true);
    expect(body).toMatchObject({
      program: { id: 4864050, group_program: 4864999, title: "Coach Plan" },
      detailAvailable: false,
    });
  });

  it("keeps an inaccessible unrelated id as a tool error", async () => {
    const handler = getProgramHandler(async (_method, path) => {
      if (path === "/3.0/coach/program/99") {
        return { ok: false, status: 401, data: "Cannot access program" };
      }
      if (path === "/1.0/coach/programs") {
        return { ok: true, status: 200, data: [{ id: 42, title: "Known program" }] };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const result = await handler({ programId: 99 }, {} as ServerContext);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("HTTP 401");
  });
});
