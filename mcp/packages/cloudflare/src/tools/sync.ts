import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coerceInt } from "@trainheroic-unofficial/js";
import { MessagingStore } from "../store/messaging";
import { ProgrammingStore } from "../store/programming";
import type { TrainHeroicClient } from "@trainheroic-unofficial/js";
import {
  attempt,
  errorResult,
  idParam,
  jsonResult,
  READ,
  SYNC,
  toId,
} from "@trainheroic-unofficial/core";

/**
 * Warehouse sync + read tools for the programming and messaging zones. These persist
 * to D1, so they are part of the hosted (Cloudflare) server only, not the local one.
 */
export function registerSyncTools(
  server: McpServer,
  db: D1Database,
  client: TrainHeroicClient,
): void {
  const programming = new ProgrammingStore(db, client);
  const messaging = new MessagingStore(db, client);

  server.registerTool(
    "programming_sync",
    {
      title: "Sync programming",
      description:
        "Pull prescribed programs (sessions/blocks/sets) into the local store. Walks each " +
        "calendar's month window. Omit programId to sync all programs + team group-programs.",
      inputSchema: { programId: idParam.optional() },
      annotations: SYNC,
    },
    ({ programId }) =>
      attempt(async () => {
        if (programId === undefined) return jsonResult(await programming.syncAll());
        // Title is cosmetic and preserved on conflict, so skip the listCalendars round-trips.
        return jsonResult(await programming.syncCalendar(toId(programId)));
      }),
  );

  server.registerTool(
    "programming_get",
    {
      title: "Get program sessions (stored)",
      description: "List a program's sessions from the local store (run programming_sync first).",
      inputSchema: { programId: idParam },
      annotations: READ,
    },
    ({ programId }) =>
      attempt(async () => jsonResult(await programming.getProgramSessions(toId(programId)))),
  );

  server.registerTool(
    "programming_session",
    {
      title: "Get session detail (stored)",
      description: "Blocks and prescribed sets for one stored session id.",
      inputSchema: { sessionId: idParam },
      annotations: READ,
    },
    ({ sessionId }) =>
      attempt(async () => jsonResult(await programming.getSession(toId(sessionId)))),
  );

  server.registerTool(
    "messaging_sync",
    {
      title: "Sync messages",
      description:
        "Pull chat streams + comments into the local store, incrementally per stream. " +
        "Omit streamId to sync all. full=true re-pulls from the beginning (refreshes reactions/replies).",
      inputSchema: { streamId: idParam.optional(), full: z.boolean().optional() },
      annotations: SYNC,
    },
    ({ streamId, full }) =>
      attempt(async () => {
        if (streamId === undefined) return jsonResult(await messaging.syncAll(full ?? false));
        const id = toId(streamId);
        const found = (await messaging.listStreams()).find((x) => coerceInt(x.stream.id) === id);
        if (!found) return errorResult(`Stream ${id} not found in /v5/messaging/streams.`);
        return jsonResult(await messaging.syncStream(found.stream, found.kind, full ?? false));
      }),
  );

  server.registerTool(
    "messaging_streams",
    {
      title: "List stored conversations",
      description:
        "Conversations from the local store (run messaging_sync first). Use the id with messaging_history.",
      inputSchema: {},
      annotations: READ,
    },
    () => attempt(async () => jsonResult(await messaging.streams())),
  );

  server.registerTool(
    "messaging_history",
    {
      title: "Stored conversation history",
      description: "Comments for a stream from the local store, newest first.",
      inputSchema: { streamId: idParam, limit: z.number().int().positive().max(200).optional() },
      annotations: READ,
    },
    ({ streamId, limit }) =>
      attempt(async () => jsonResult(await messaging.history(toId(streamId), limit ?? 50))),
  );
}
