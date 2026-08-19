import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { coerceInt, dateString } from "@trainheroic-unofficial/js";
import { MessagingStore, ProgrammingStore, type Warehouse } from "@trainheroic-unofficial/db";
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
import { hostedWarehouseOutputSchemas } from "../tool-contracts";

function registerProgrammingTools(server: McpServer, programming: ProgrammingStore): void {
  server.registerTool(
    "programming_sync",
    {
      title: "Sync programming history",
      description:
        "Populate the programming history warehouse: pull prescribed programs " +
        "(sessions/blocks/sets) across an ~18-month window into D1. Omit programId to sync all " +
        "programs + team group-programs (heavy — many upstream calls). Then read with programming_stored.",
      inputSchema: { programId: idParam.optional() },
      outputSchema: hostedWarehouseOutputSchemas.programming_sync,
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
    "programming_stored",
    {
      title: "Query programming history",
      description:
        "Query the prescribed-programming history warehouse (populate it with programming_sync first). " +
        "Give sessionId for one session's blocks and prescribed sets; give programId for that " +
        "program's newest-first session list (limited to 200 by default). For the current full " +
        "structure of one program live from the API, use get_program. To continue a stored list, " +
        "pass the last row's date/id in `before`.",
      inputSchema: {
        programId: idParam.optional(),
        sessionId: idParam.optional(),
        limit: z.number().int().positive().max(500).optional(),
        before: z.object({ date: dateString.nullable(), sessionId: idParam }).optional(),
      },
      outputSchema: hostedWarehouseOutputSchemas.programming_stored,
      annotations: READ,
    },
    ({ programId, sessionId, limit, before }) =>
      attempt(async () => {
        if (programId !== undefined && sessionId !== undefined) {
          return errorResult("Provide programId or sessionId, not both.");
        }
        if (sessionId !== undefined) {
          if (limit !== undefined || before !== undefined) {
            return errorResult("sessionId detail mode cannot include a list limit or cursor.");
          }
          return jsonResult(await programming.getSession(toId(sessionId)));
        }
        if (programId !== undefined) {
          const cursor =
            before === undefined ? undefined : { date: before.date, id: toId(before.sessionId) };
          return jsonResult(
            await programming.getProgramSessions(toId(programId), limit ?? 200, cursor),
          );
        }
        return errorResult("Provide programId (session list) or sessionId (session detail).");
      }),
  );
}

function registerMessagingTools(server: McpServer, messaging: MessagingStore): void {
  server.registerTool(
    "messaging_sync",
    {
      title: "Sync message history",
      description:
        "Populate the messaging history warehouse: pull chat streams + comments into D1, " +
        "incrementally per stream. Omit streamId to sync all. full=true re-pulls from the " +
        "beginning (refreshes reactions and replies on existing threads). Then read with messaging_stored.",
      inputSchema: { streamId: idParam.optional(), full: z.boolean().optional() },
      outputSchema: hostedWarehouseOutputSchemas.messaging_sync,
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
    "messaging_stored",
    {
      title: "Query message history",
      description:
        "Query the conversation history warehouse (populate it with messaging_sync first). Give " +
        "streamId for that stream's comments (newest first); omit it to list conversations. Lists " +
        "are limited to 50 by default. Continue with `before` from the last row: its timestamp is " +
        "the comment `ts` when streamId is set, or conversation `last_viewed` otherwise. " +
        "For current/live data from the API, use messaging_conversations and messaging_read.",
      inputSchema: {
        streamId: idParam.optional(),
        limit: z.number().int().positive().max(200).optional(),
        before: z
          .object({ timestamp: z.number().int().nonnegative().nullable(), id: idParam })
          .optional(),
      },
      outputSchema: hostedWarehouseOutputSchemas.messaging_stored,
      annotations: READ,
    },
    ({ streamId, limit, before }) =>
      attempt(async () => {
        if (streamId === undefined) {
          const cursor =
            before === undefined
              ? undefined
              : { lastViewed: before.timestamp, id: toId(before.id) };
          return jsonResult(await messaging.streams(limit ?? 50, cursor));
        }
        const cursor =
          before === undefined ? undefined : { ts: before.timestamp, id: toId(before.id) };
        return jsonResult(await messaging.history(toId(streamId), limit ?? 50, cursor));
      }),
  );
}

/**
 * History warehouse tools for the programming and messaging zones. These accumulate a
 * time-series the live API cannot return in one call (18 months of prescribed sessions; full
 * conversation history), so they are a deliberately-populated store, not a cache: one sync
 * verb populates the zone, one query tool reads it. They persist to D1 (hosted only). For
 * current data, the live core tools `get_program` / `messaging_conversations` / `messaging_read`
 * are the default.
 */
export function registerSyncTools(
  server: McpServer,
  warehouse: Warehouse,
  client: TrainHeroicClient,
  orgId: number | null = null,
): void {
  registerProgrammingTools(server, new ProgrammingStore(warehouse, client, orgId));
  registerMessagingTools(server, new MessagingStore(warehouse, client, orgId));
}
