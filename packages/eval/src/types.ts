// Shared types for the eval harness. Both surfaces (MCP and CLI) drive a headless `claude -p`
// against the fake backend and reduce the run to the same RunTranscript shape, so one scenario and
// one grader work across both — that parity is the point.

import type { Dataset } from "./datasets";

export type Surface = "mcp" | "cli";
/** The account role a scenario drives. Orthogonal to surface: each (role, surface) is one run config. */
export type Role = "coach" | "athlete";

export type ToolCall = {
  /** Canonical capability name, normalized across surfaces (e.g. "list_teams", "athlete_saved_workouts"). */
  name: string;
  /** Canonical args (e.g. { programId, limit, q }), normalized from MCP tool input or CLI flags. */
  input: Record<string, unknown>;
  /** The surface-native name before normalization — MCP tool id, or the raw `trainheroic …` command. */
  rawName: string;
  isError: boolean;
  /** True when the result carried a truncation marker. */
  truncated: boolean;
};

export type RunTranscript = {
  surface: Surface;
  toolCalls: ToolCall[];
  /** The model's final answer (the `result` event). Includes the EVAL REPORT block. */
  finalText: string;
  /** The answer portion, before the EVAL REPORT block. */
  answerText: string;
  evalReport: string | null;
  /** Did the surface connect/launch? (MCP server connected, or the CLI shim was reachable.) */
  connected: boolean;
  costUsd: number;
  numTurns: number;
  timedOut: boolean;
  /** Raw stream-json lines, for debugging a parse miss. */
  raw: string[];
};

export type RunOptions = { model: string; timeoutMs?: number };

/**
 * A surface driver: given the fake backend URL and a question, run one headless `claude -p` and
 * return the normalized transcript. The MCP and CLI drivers differ only in how they launch claude
 * and how they normalize each tool/command call to a canonical capability name.
 */
export type Driver = {
  surface: Surface;
  runOnce: (url: string, query: string, today: string, opts: RunOptions) => Promise<RunTranscript>;
};

export type Grade = { pass: boolean; reason: string };

export type Scenario = {
  name: string;
  dataset: Dataset;
  query: string;
  today: string;
  grade: (t: RunTranscript) => Grade;
  /** The account role this scenario drives. Defaults to "coach". */
  role?: Role;
  /** Which surfaces this scenario runs on. Defaults to both. */
  surfaces?: Surface[];
  /** Default K and threshold; overridable via EVAL_K / EVAL_THRESHOLD. */
  k?: number;
  threshold?: number;
};

export const EVAL_REPORT_START = "===EVAL REPORT===";
export const EVAL_REPORT_END = "===END EVAL REPORT===";
