import * as Sentry from "@sentry/cloudflare";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult, jsonResult } from "@trainheroic-unofficial/core";
import type { RecentToolCall } from "../tool-metrics";

/**
 * Everything the feedback tool needs that lives outside the MCP request: the reporter's identity
 * (the email is the one user datum we keep, see sentry.ts), the opaque session id, the running
 * build, and a getter for the session's recent tool calls. `release` is `string | undefined`
 * because `SENTRY_RELEASE` is only set during a deploy.
 */
export interface FeedbackToolDeps {
  email: string;
  role: string;
  sessionId: string;
  version: string;
  release: string | undefined;
  /** A snapshot of the session's recent tool calls (oldest first), for the report context. */
  recentCalls: () => readonly RecentToolCall[];
}

/** The kinds of report a user can file. Bug is the default, since that is the common case. */
const KINDS = ["bug", "idea", "praise", "other"] as const;
type Kind = (typeof KINDS)[number];

const TOOL_NAME = "report_feedback";

const DESCRIPTION =
  "Report a bug or send feedback about this TrainHeroic assistant itself — a tool that errored or " +
  "returned the wrong thing, a confusing result, a missing capability, or a suggestion. This is " +
  "for problems with the integration, NOT for anything about the user's actual training data. " +
  "Call it only when the user explicitly asks to report a bug or leave feedback; do not file " +
  "reports on your own. Pass the user's description in their own words as `message`; for a bug, " +
  "fill `expected` and `actual` if the user said what they expected versus what happened. The " +
  "current session, role, app version, and the last few tool calls are attached automatically, so " +
  "you do not need to gather or restate any of that. The reply carries a reference id to share " +
  "with the user.";

/** The arguments the model supplies (after zod parsing applies the `kind` default). */
interface FeedbackInput {
  message: string;
  kind: Kind;
  expected?: string | undefined;
  actual?: string | undefined;
}

/**
 * The fully-resolved report: the user's input plus the auto-captured, non-PII context, computed
 * once so the message body, the Sentry contexts, and the log fallback all derive from one source
 * (and cannot drift apart). `release` is normalized to `null` when unset. Carries no PII; the
 * reporter's email is held separately and set as the feedback contact, never folded in here.
 */
interface FeedbackReport {
  message: string;
  kind: Kind;
  expected?: string | undefined;
  actual?: string | undefined;
  role: string;
  session: string;
  version: string;
  release: string | null;
  recentCalls: readonly RecentToolCall[];
}

/** Resolve the tool input against the session context into one report object. */
function buildReport(input: FeedbackInput, deps: FeedbackToolDeps): FeedbackReport {
  return {
    message: input.message.trim(),
    kind: input.kind,
    expected: input.expected?.trim(),
    actual: input.actual?.trim(),
    role: deps.role,
    session: deps.sessionId,
    version: deps.version,
    release: deps.release ?? null,
    recentCalls: deps.recentCalls(),
  };
}

/** Render the recent-call buffer as a compact, human-readable line for the report body. */
function formatRecentCalls(calls: readonly RecentToolCall[]): string {
  if (calls.length === 0) return "(none recorded)";
  return calls.map((c) => `${c.tool} [${c.surface}] ${c.status} ${c.ms}ms`).join("\n");
}

/**
 * Build the self-contained report body sent to Sentry / the logs. Everything material is inlined
 * here (rather than relying only on tags/contexts) so the report is readable on its own in the
 * Sentry feedback view, which surfaces the message prominently.
 */
function composeMessage(r: FeedbackReport): string {
  const lines: string[] = [r.message, ""];
  if (r.expected) lines.push(`Expected: ${r.expected}`);
  if (r.actual) lines.push(`Actual: ${r.actual}`);
  if (r.expected || r.actual) lines.push("");
  lines.push(
    "— context —",
    `kind: ${r.kind}`,
    `role: ${r.role}`,
    `session: ${r.session}`,
    `version: ${r.version}`,
    `release: ${r.release ?? "(unset)"}`,
    "",
    "recent tool calls (oldest first):",
    formatRecentCalls(r.recentCalls),
  );
  return lines.join("\n");
}

/**
 * Register the `report_feedback` tool. It routes a user's bug report or feedback to Sentry's user
 * feedback channel (`Sentry.captureFeedback`) when a DSN is configured, and falls back to a
 * structured `console` log otherwise, so a report is never silently dropped in local dev or an
 * unconfigured deploy.
 *
 * Hosted-only (it depends on the Worker's Sentry setup and the session ring buffer), so it lives
 * here rather than in `core`. It is not gated: filing a report is an additive, user-initiated
 * action, and the description tells the model to call it only on an explicit request.
 *
 * Privacy: the report carries the reporter's email (their own, voluntarily submitted) plus the
 * same non-PII session/tool context the metrics and spans already hold — never tool arguments,
 * tool results, or any other athlete data.
 */
export function registerFeedbackTool(server: McpServer, deps: FeedbackToolDeps): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Report a bug or send feedback",
      description: DESCRIPTION,
      inputSchema: {
        message: z.string().min(1).describe("The user's report or feedback, in their own words."),
        kind: z
          .enum(KINDS)
          .default("bug")
          .describe("What kind of report this is. Defaults to a bug report."),
        expected: z.string().optional().describe("For a bug: what the user expected to happen."),
        actual: z.string().optional().describe("For a bug: what actually happened."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        // Talks to an external service (Sentry), so the world is open.
        openWorldHint: true,
      },
    },
    (args): CallToolResult => {
      try {
        const report = buildReport(args, deps);
        const message = composeMessage(report);
        const tags = {
          "feedback.kind": report.kind,
          "mcp.role": report.role,
          "mcp.session": report.session,
        };

        if (Sentry.isEnabled()) {
          // captureFeedback sends a `type: "feedback"` event, which the `beforeSend` user-clamp in
          // sentry.ts does NOT run on. The privacy invariant on this path rests entirely on
          // `sendDefaultPii: false` plus only ever calling `setUser` with the email — keep it so.
          const eventId = Sentry.withScope((scope) => {
            scope.setContext("mcp", {
              kind: report.kind,
              role: report.role,
              session: report.session,
              version: report.version,
              release: report.release,
            });
            scope.setContext("recent_tool_calls", { calls: report.recentCalls });
            // Tags ride on `params`; the contexts ride on the forked scope captureFeedback reads.
            return Sentry.captureFeedback({ message, email: deps.email, source: TOOL_NAME, tags });
          });
          return jsonResult({
            status: "sent",
            // Empty when the event was dropped (e.g. sampling); omit it rather than show a blank id.
            ...(eventId ? { reference: eventId } : {}),
            note: "Thanks — your report was sent to the maintainers.",
          });
        }

        // No DSN configured: keep the report from vanishing by logging it. Email included here only
        // because this path runs in local dev / an unconfigured deploy, where logs are the only sink.
        console.log(
          "[feedback]",
          JSON.stringify({
            kind: report.kind,
            email: deps.email,
            session: report.session,
            message,
          }),
        );
        return jsonResult({
          status: "logged",
          note: "Thanks — feedback delivery is not configured here, so your report was written to the server log.",
        });
      } catch (err) {
        // Honor the in-band convention: never throw to the transport, return a self-correctable error.
        return errorResult(
          `Could not file your report: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}
