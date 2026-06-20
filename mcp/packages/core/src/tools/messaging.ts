import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { commentDraftSchema } from "@trainheroic-unofficial/dto";
import {
  buildCommentPayload,
  deleteComment,
  fetchStreams,
  readLive,
  sendComment,
} from "@trainheroic-unofficial/js";
import { confirmGate, NOT_CONFIRMED } from "../confirm";
import { attempt, DESTRUCTIVE, errorResult, idParam, jsonResult, READ, toId } from "../context";
import type { ToolContext } from "../context";

function registerReads(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "messaging_conversations",
    {
      title: "List conversations (live)",
      description: "Live list of chat streams (id, kind, title). Use the id to read/draft/send.",
      inputSchema: {},
      annotations: READ,
    },
    () =>
      attempt(async () => {
        const streams = await fetchStreams(ctx.client);
        return jsonResult(
          streams.map(({ stream, kind }) => ({
            id: stream.id,
            kind,
            title: stream.title ?? "",
            teamId: stream.teamId,
            userId: stream.userId,
          })),
        );
      }),
  );

  server.registerTool(
    "messaging_read",
    {
      title: "Read messages (live)",
      description: "Recent messages in a stream, straight from the API.",
      inputSchema: { streamId: idParam, limit: z.number().int().positive().max(200).optional() },
      annotations: READ,
    },
    ({ streamId, limit }) =>
      attempt(async () => jsonResult(await readLive(ctx.client, toId(streamId), limit ?? 20))),
  );

  server.registerTool(
    "message_draft",
    {
      title: "Draft a message (preview only)",
      description: "Preview the exact payload and target WITHOUT sending. Always safe.",
      inputSchema: commentDraftSchema.shape,
      annotations: READ,
    },
    ({ streamId, text, replyTo }) =>
      attempt(async () => {
        const id = toId(streamId);
        return jsonResult({
          draft: true,
          note: "NOT sent. This is a preview. Run message_send to deliver it.",
          would_POST: `/v5/messaging/streams/${id}/comments`,
          payload: buildCommentPayload(id, text, replyTo === undefined ? null : toId(replyTo)),
        });
      }),
  );
}

function registerWrites(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "message_send",
    {
      title: "Send a message",
      description:
        "Send a chat message — ATHLETE-FACING and immediate (no draft state on the server). " +
        "Requires confirmation (elicitation, or confirm:true). Prefer message_draft first.",
      inputSchema: { ...commentDraftSchema.shape, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ streamId, text, replyTo, confirm }, extra) =>
      attempt(async () => {
        const id = toId(streamId);
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Send this message to stream ${id}? It is athlete-facing and immediate.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        const comment = await sendComment(
          ctx.client,
          id,
          text,
          replyTo === undefined ? null : toId(replyTo),
        );
        return jsonResult({ sent: true, comment });
      }),
  );

  server.registerTool(
    "message_delete",
    {
      title: "Delete a message",
      description: "Soft-delete a chat message on the live account. Requires confirmation.",
      inputSchema: { streamId: idParam, commentId: idParam, confirm: z.boolean().optional() },
      annotations: DESTRUCTIVE,
    },
    ({ streamId, commentId, confirm }, extra) =>
      attempt(async () => {
        const ok = await confirmGate(
          server,
          extra.requestId,
          `Delete comment ${toId(commentId)} from stream ${toId(streamId)}? Acts on the live account.`,
          confirm,
        );
        if (!ok) return errorResult(NOT_CONFIRMED);
        return jsonResult({
          deleted: true,
          response: await deleteComment(ctx.client, toId(streamId), toId(commentId)),
        });
      }),
  );
}

/** Live messaging: list/read conversations, draft a message, and the gated send/delete. */
export function registerMessagingTools(server: McpServer, ctx: ToolContext): void {
  registerReads(server, ctx);
  registerWrites(server, ctx);
}
