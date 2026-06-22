// Shared spawn + stream-json parser used by both surface drivers. A driver supplies how to launch
// claude and a `normalize` that maps each surface-native call (an MCP tool_use, or a `trainheroic …`
// Bash command) to a canonical capability name; everything else — buffering JSONL, correlating
// tool results, slicing the EVAL REPORT — is identical, so the two surfaces produce the same
// RunTranscript shape and feed the same graders.

import { spawn } from "node:child_process";
import { EVAL_REPORT_END, EVAL_REPORT_START } from "./types";
import type { RunTranscript, Surface, ToolCall } from "./types";

/** Map a surface-native call to a canonical capability call, or null to ignore it (e.g. a Bash
 * command that isn't a `trainheroic` invocation). */
export type Normalize = (
  rawName: string,
  input: Record<string, unknown>,
) => { name: string; input: Record<string, unknown> } | null;

export type SpawnSpec = {
  surface: Surface;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  normalize: Normalize;
};

function contentTruncated(content: unknown): boolean {
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  return text.includes("__truncated") || text.includes("[TRUNCATED:");
}

type StreamEvent = {
  type?: string;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  mcp_servers?: Array<{ name?: string; status?: string }>;
  message?: { content?: unknown };
};
type ContentBlock = Record<string, unknown>;

function contentBlocks(ev: StreamEvent): ContentBlock[] {
  return Array.isArray(ev.message?.content) ? (ev.message.content as ContentBlock[]) : [];
}

function collectToolUses(
  ev: StreamEvent,
  normalize: Normalize,
  toolCalls: ToolCall[],
  byId: Map<string, number>,
): void {
  for (const block of contentBlocks(ev)) {
    if (block.type !== "tool_use" || typeof block.name !== "string") continue;
    const input = (block.input as Record<string, unknown>) ?? {};
    const canon = normalize(block.name, input);
    if (canon === null) continue;
    const rawName =
      block.name === "Bash" && typeof input.command === "string" ? input.command : block.name;
    const id = typeof block.id === "string" ? block.id : `idx${toolCalls.length}`;
    byId.set(id, toolCalls.length);
    toolCalls.push({
      name: canon.name,
      input: canon.input,
      rawName,
      isError: false,
      truncated: false,
    });
  }
}

function applyToolResults(ev: StreamEvent, toolCalls: ToolCall[], byId: Map<string, number>): void {
  for (const block of contentBlocks(ev)) {
    if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
    const idx = byId.get(block.tool_use_id);
    const call = idx === undefined ? undefined : toolCalls[idx];
    if (!call) continue;
    call.isError = block.is_error === true;
    call.truncated = contentTruncated(block.content);
  }
}

function parseEvents(
  lines: readonly string[],
  surface: Surface,
  normalize: Normalize,
): Omit<RunTranscript, "timedOut" | "raw" | "writes"> {
  const toolCalls: ToolCall[] = [];
  const byId = new Map<string, number>();
  let finalText = "";
  let costUsd = 0;
  let numTurns = 0;
  let mcpConnected = false;
  let sawResult = false;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let ev: StreamEvent;
    try {
      ev = JSON.parse(line) as StreamEvent;
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init") {
      mcpConnected = (ev.mcp_servers ?? []).some((s) => s.status === "connected");
    } else if (ev.type === "assistant") {
      collectToolUses(ev, normalize, toolCalls, byId);
    } else if (ev.type === "user") {
      applyToolResults(ev, toolCalls, byId);
    } else if (ev.type === "result") {
      sawResult = true;
      finalText = typeof ev.result === "string" ? ev.result : "";
      costUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0;
      numTurns = typeof ev.num_turns === "number" ? ev.num_turns : 0;
    }
  }

  const startIdx = finalText.indexOf(EVAL_REPORT_START);
  const answerText = startIdx >= 0 ? finalText.slice(0, startIdx).trim() : finalText.trim();
  let evalReport: string | null = null;
  if (startIdx >= 0) {
    const endIdx = finalText.indexOf(EVAL_REPORT_END, startIdx);
    evalReport = finalText.slice(
      startIdx,
      endIdx >= 0 ? endIdx + EVAL_REPORT_END.length : undefined,
    );
  }
  // The CLI surface has no MCP server, so "connected" means the run launched and produced a result.
  const connected = surface === "mcp" ? mcpConnected : sawResult;

  return { surface, toolCalls, finalText, answerText, evalReport, connected, costUsd, numTurns };
}

/** Spawn claude, stream its JSONL stdout, and return the parsed transcript. */
export function spawnAndParse(spec: SpawnSpec): Promise<RunTranscript> {
  const lines: string[] = [];
  return new Promise((resolveRun) => {
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
    let buf = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, spec.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        lines.push(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    });
    child.stderr.on("data", () => {
      // surface/claude diagnostics; ignored (the transcript carries what we grade on).
    });

    // close and error can both fire; the settled guard makes the run resolve exactly once.
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buf.trim().length > 0) lines.push(buf);
      const parsed = parseEvents(lines, spec.surface, spec.normalize);
      // The harness fills `writes` from the backend after the run (the driver can't see it).
      // oxlint-disable-next-line promise/no-multiple-resolved -- guarded by `settled`
      resolveRun({ ...parsed, timedOut, writes: [], raw: lines });
    };
    child.on("close", finish);
    child.on("error", finish);
  });
}
