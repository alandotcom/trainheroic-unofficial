import { describe, expect, it } from "vitest";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import {
  CLIENT_CAPABILITIES_META_KEY,
  createMcpHandler,
  isInputRequiredResult,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { confirmGate, NOT_CONFIRMED } from "../src/confirm";

function fakeCtx(inputResponses?: Record<string, unknown>): ServerContext {
  return {
    mcpReq: {
      inputResponses,
    },
  } as unknown as ServerContext;
}

function modernCtx(clientCapabilities: Record<string, unknown>): ServerContext {
  return {
    mcpReq: {
      envelope: { [CLIENT_CAPABILITIES_META_KEY]: clientCapabilities },
    },
  } as unknown as ServerContext;
}

describe("confirmGate", () => {
  it("returns undefined on an explicit confirm flag", () => {
    expect(confirmGate(fakeCtx(), "msg", true)).toBeUndefined();
  });

  it("returns input_required on first call without confirm", () => {
    const blocked = confirmGate(fakeCtx(), "Delete this?", undefined);
    expect(blocked).toBeDefined();
    expect(isInputRequiredResult(blocked)).toBe(true);
  });

  it("returns an actionable in-band error when a modern client cannot elicit", () => {
    const blocked = confirmGate(modernCtx({}), "Split the exercise into two blocks?", undefined);

    expect(isInputRequiredResult(blocked)).toBe(false);
    expect((blocked as CallToolResult).isError).toBe(true);
    expect((blocked as CallToolResult).content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/ask the user.*confirm:true.*nothing was changed/iu),
    });
  });

  it.each([{ elicitation: {} }, { elicitation: { form: {} } }])(
    "returns input_required when a modern client declares form elicitation (%j)",
    (clientCapabilities) => {
      const blocked = confirmGate(modernCtx(clientCapabilities), "Delete this?", undefined);

      expect(isInputRequiredResult(blocked)).toBe(true);
    },
  );

  it("returns an in-band error when a modern client declares only URL elicitation", () => {
    const blocked = confirmGate(modernCtx({ elicitation: { url: {} } }), "Delete this?", undefined);

    expect(isInputRequiredResult(blocked)).toBe(false);
    expect((blocked as CallToolResult).isError).toBe(true);
  });

  it("returns a tool error instead of -32021 through the modern HTTP transport", async () => {
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "confirm-test", version: "1.0.0" });
        server.registerTool("gated", {}, (ctx) => {
          const result = confirmGate(ctx, "Delete this?", undefined);
          if (result === undefined) throw new Error("Expected confirmation to block the tool");
          return result;
        });
        return server;
      },
      { legacy: "reject" },
    );

    try {
      const response = await handler.fetch(
        new Request("https://example.test/mcp", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "MCP-Method": "tools/call",
            "MCP-Name": "gated",
            "MCP-Protocol-Version": "2026-07-28",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "gated",
              arguments: {},
              _meta: {
                [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
                [CLIENT_CAPABILITIES_META_KEY]: {},
              },
            },
          }),
        }),
      );
      const body = (await response.json()) as {
        error?: { code?: number };
        result?: CallToolResult;
      };

      expect(response.status).toBe(200);
      expect(body.error?.code).not.toBe(-32021);
      expect(body.result?.isError).toBe(true);
      expect(body.result?.content[0]).toMatchObject({
        type: "text",
        text: expect.stringMatching(/ask the user.*confirm:true.*nothing was changed/iu),
      });
    } finally {
      await handler.close();
    }
  });

  it("returns undefined when elicitation was accepted with confirm:true", () => {
    expect(
      confirmGate(
        fakeCtx({
          confirm: { action: "accept", content: { confirm: true } },
        }),
        "msg",
        undefined,
      ),
    ).toBeUndefined();
  });

  it("returns an error result when elicitation was declined", () => {
    const blocked = confirmGate(
      fakeCtx({
        confirm: { action: "decline" },
      }),
      "msg",
      undefined,
    );
    expect((blocked as CallToolResult).isError).toBe(true);
    expect((blocked as CallToolResult).content?.[0]).toMatchObject({
      type: "text",
      text: NOT_CONFIRMED,
    });
  });

  it("returns an error result when accepted but confirm is not true", () => {
    const blocked = confirmGate(
      fakeCtx({
        confirm: { action: "accept", content: { confirm: false } },
      }),
      "msg",
      undefined,
    );
    expect((blocked as CallToolResult).isError).toBe(true);
  });
});
