import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { DESTRUCTIVE, errorResult, jsonResult } from "@trainheroic-unofficial/core";
import { toolOutputSchemaFor } from "@trainheroic-unofficial/dto";
import type { AccountRole } from "../types";

/**
 * Everything the feedback tool needs outside the MCP request: reporter identity (email is the
 * one user datum we keep — see sentry.ts), correlation id, role, and build info.
 */
export interface FeedbackToolDeps {
  email: string;
  role: AccountRole;
  correlationId: string;
  version: string;
  release: string | undefined;
}

const KINDS = ["bug", "idea", "praise", "other"] as const;
type Kind = (typeof KINDS)[number];

const TOOL_NAME = "report_feedback";

const DESCRIPTION =
  "Report a bug or send feedback about this TrainHeroic assistant itself — a tool that errored or " +
  "returned the wrong thing, a confusing or incorrect result, a missing capability, or a suggestion. " +
  "It covers problems with the integration, not the user's own training data. " +
  "Call it only when the user explicitly asks to report a bug or leave feedback; never file on your own. " +
  "Aim for a report the maintainer can act on without having to come back and ask. Before filing a bug, " +
  "make sure you have a concrete problem to describe: if the user only said something like 'report a bug' " +
  "without saying what went wrong, first ask what happened, what they were doing at the time, and what " +
  "they expected, then file with their answers. Stick to what the user actually reported; do not invent " +
  "details or pad the report with filler or commentary about this reporting tool. If the user is only " +
  "checking that reporting works, say that plainly in `message` and leave `expected` and `actual` empty " +
  "rather than making up a bug. Role, app version, and a correlation id are attached automatically — " +
  "do not gather or restate those. The reply carries a reference id to share with the user.";

interface FeedbackInput {
  message: string;
  kind: Kind;
  expected?: string | undefined;
  actual?: string | undefined;
}

interface FeedbackReport {
  message: string;
  kind: Kind;
  expected?: string | undefined;
  actual?: string | undefined;
  role: AccountRole;
  correlationId: string;
  version: string;
  release: string | null;
}

function buildReport(input: FeedbackInput, deps: FeedbackToolDeps): FeedbackReport {
  return {
    message: input.message.trim(),
    kind: input.kind,
    expected: input.expected?.trim(),
    actual: input.actual?.trim(),
    role: deps.role,
    correlationId: deps.correlationId,
    version: deps.version,
    release: deps.release ?? null,
  };
}

function composeMessage(r: FeedbackReport): string {
  const lines: string[] = [r.message, ""];
  if (r.expected) lines.push(`Expected: ${r.expected}`);
  if (r.actual) lines.push(`Actual: ${r.actual}`);
  if (r.expected || r.actual) lines.push("");
  lines.push(
    "— context —",
    `kind: ${r.kind}`,
    `role: ${r.role}`,
    `correlation: ${r.correlationId}`,
    `version: ${r.version}`,
    `release: ${r.release ?? "(unset)"}`,
  );
  return lines.join("\n");
}

/**
 * Register the `report_feedback` tool. Routes to Sentry's user feedback channel when a DSN is
 * configured, otherwise structured `console` log. Hosted-only (depends on Worker Sentry setup).
 */
export function registerFeedbackTool(server: McpServer, deps: FeedbackToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Report a bug or send feedback",
      description: DESCRIPTION,
      inputSchema: {
        message: z
          .string()
          .min(1)
          .describe(
            "The specific problem in the user's own words: what they were doing and what went wrong. " +
              "Open with a short, concrete summary line (it becomes the report's title), then add any " +
              "detail. Keep it specific and free of placeholder or meta text about this reporting tool.",
          ),
        kind: z
          .enum(KINDS)
          .default("bug")
          .describe("What kind of report this is. Defaults to a bug report."),
        expected: z
          .string()
          .optional()
          .describe(
            "For a bug: what the user expected to happen. Leave empty for a test or non-bug feedback.",
          ),
        actual: z
          .string()
          .optional()
          .describe(
            "For a bug: what actually happened instead. Leave empty for a test or non-bug feedback.",
          ),
      },
      outputSchema: toolOutputSchemaFor(TOOL_NAME),
      annotations: {
        ...DESTRUCTIVE,
        idempotentHint: false,
      },
    },
    (args): CallToolResult => {
      try {
        const report = buildReport(args, deps);
        const message = composeMessage(report);
        const tags = {
          "feedback.kind": report.kind,
          "mcp.role": report.role,
          "mcp.session": report.correlationId,
        };

        if (Sentry.isEnabled()) {
          // captureFeedback sends a `type: "feedback"` event, which the `beforeSend` user-clamp
          // in sentry.ts does NOT run on. The privacy invariant on this path rests entirely on
          // `sendDefaultPii: false` plus only ever calling `setUser` with the email — keep it so.
          const eventId = Sentry.withScope((scope) => {
            scope.setContext("mcp", {
              kind: report.kind,
              role: report.role,
              correlationId: report.correlationId,
              version: report.version,
              release: report.release,
            });
            // Tags ride on `params`; the contexts ride on the forked scope captureFeedback reads.
            return Sentry.captureFeedback({ message, email: deps.email, source: TOOL_NAME, tags });
          });
          return jsonResult({
            status: "sent",
            ...(eventId ? { reference: eventId } : {}),
            note: "Thanks — your report was sent to the maintainers.",
          });
        }

        console.log(
          "[feedback]",
          JSON.stringify({
            kind: report.kind,
            email: deps.email,
            correlationId: report.correlationId,
            message,
          }),
        );
        return jsonResult({
          status: "logged",
          note: "Thanks — feedback delivery is not configured here, so your report was written to the server log.",
        });
      } catch (err) {
        return errorResult(
          `Could not file your report: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
