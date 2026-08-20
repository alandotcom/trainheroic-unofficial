import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  commentDraftSchema,
  messageDeletedOutputSchema,
  messageDraftOutputSchema,
  messageSentOutputSchema,
  opaqueOutputSchema,
  toolOutputSchema,
} from "@trainheroic-unofficial/dto";
import {
  buildCommentPayload,
  deleteComment,
  fetchStreams,
  readLive,
  sendComment,
} from "@trainheroic-unofficial/js";
import { confirmGate } from "../confirm";
import { attempt, DESTRUCTIVE, idParam, jsonResult, READ, toId } from "../context";
import type { ToolContext } from "../context";

function registerReads(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "messaging_conversations",
    {
      title: "List conversations (live)",
      description:
        "List chat streams (id, kind, title) live from the API; no setup needed. Use the id to read/draft/send.",
      inputSchema: {},
      outputSchema: opaqueOutputSchema,
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
      description:
        "Comments in a stream, live from the API. Pass `afterCommentId` to fetch only newer " +
        "comments upstream; cursor reads return the oldest unseen comments first, bounded by " +
        "`limit`, so advance with the last returned comment ID to continue without gaps. " +
        "Without it, the stream is fetched whole, then trimmed to `limit` (default 20). Each " +
        "comment's `isAuthor` is true when the logged-in " +
        "user sent it — to answer 'did an athlete message me', look for comments with " +
        "isAuthor:false. Timestamps are Unix seconds. An empty result means the thread has no " +
        "messages.",
      inputSchema: {
        streamId: idParam,
        limit: z.number().int().positive().max(200).optional(),
        afterCommentId: idParam.optional(),
      },
      outputSchema: opaqueOutputSchema,
      annotations: READ,
    },
    ({ streamId, limit, afterCommentId }) =>
      attempt(async () =>
        jsonResult(
          await readLive(
            ctx.client,
            toId(streamId),
            limit ?? 20,
            afterCommentId === undefined ? undefined : toId(afterCommentId),
          ),
        ),
      ),
  );

  server.registerTool(
    "message_draft",
    {
      title: "Draft a message (preview only)",
      description: "Preview the exact payload and target WITHOUT sending. Always safe.",
      inputSchema: commentDraftSchema.shape,
      outputSchema: toolOutputSchema(messageDraftOutputSchema),
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
      outputSchema: toolOutputSchema(messageSentOutputSchema),
      annotations: DESTRUCTIVE,
    },
    ({ streamId, text, replyTo, confirm }, extra) =>
      attempt(async () => {
        const id = toId(streamId);
        const blocked = confirmGate(
          extra,
          `Send this message to stream ${id}? It is athlete-facing and immediate.`,
          confirm,
        );
        if (blocked) return blocked;
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
      outputSchema: toolOutputSchema(messageDeletedOutputSchema),
      annotations: DESTRUCTIVE,
    },
    ({ streamId, commentId, confirm }, extra) =>
      attempt(async () => {
        const blocked = confirmGate(
          extra,
          `Delete comment ${toId(commentId)} from stream ${toId(streamId)}? Acts on the live account.`,
          confirm,
        );
        if (blocked) return blocked;
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
