// The scenario runner. Boots the fake backend, drives a scenario K times through one surface's
// driver (MCP or CLI), grades each run from the normalized tool-call trace, and reports the
// pass-rate against a threshold. Because both drivers produce the same RunTranscript and the
// graders work on canonical capability names, a scenario runs unchanged on either surface — the
// parity that lets MCP and CLI be compared directly.

import { spawnSync } from "node:child_process";
import { startBackend } from "./fake-backend";
import { cliDriver } from "./surfaces/cli";
import { mcpDriver } from "./surfaces/mcp";
import type { Driver, Grade, Role, RunTranscript, Scenario, Surface } from "./types";

function driverFor(surface: Surface, role: Role): Driver {
  return surface === "mcp" ? mcpDriver(role) : cliDriver(role);
}

export type ScenarioResult = {
  name: string;
  surface: Surface;
  model: string;
  k: number;
  threshold: number;
  passes: number;
  rate: number;
  totalCostUsd: number;
  report: string;
};

function resolveModel(override?: string): string {
  return override ?? process.env.EVAL_MODEL ?? "sonnet";
}

/** Run a scenario K times on one surface against a fresh backend; returns the pass-rate + report. */
export async function runScenario(
  scenario: Scenario,
  surface: Surface,
  opts: { model?: string; k?: number; threshold?: number } = {},
): Promise<ScenarioResult> {
  const driver = driverFor(surface, scenario.role ?? "coach");
  const model = resolveModel(opts.model);
  const k = opts.k ?? (Number(process.env.EVAL_K) || scenario.k || 5);
  const threshold =
    opts.threshold ?? (Number(process.env.EVAL_THRESHOLD) || scenario.threshold || 0.6);

  const backend = await startBackend(scenario.dataset);
  const runs: Array<{ grade: Grade; t: RunTranscript }> = [];
  try {
    for (let i = 0; i < k; i += 1) {
      const t = await driver.runOnce(backend.url, scenario.query, scenario.today, { model });
      const grade = scenario.grade(t);
      runs.push({ grade, t });
      process.stderr.write(
        `[eval ${scenario.name}/${surface}] run ${i + 1}/${k} (${model}): ${grade.pass ? "PASS" : "FAIL"} — ${grade.reason}\n`,
      );
    }
  } finally {
    await backend.close();
  }

  const passes = runs.filter((r) => r.grade.pass).length;
  const rate = passes / k;
  const totalCostUsd = runs.reduce((sum, r) => sum + r.t.costUsd, 0);
  const report = formatReport(scenario, surface, model, runs, {
    passes,
    rate,
    threshold,
    totalCostUsd,
    unmatched: backend.unmatched,
  });
  return { name: scenario.name, surface, model, k, threshold, passes, rate, totalCostUsd, report };
}

function formatReport(
  scenario: Scenario,
  surface: Surface,
  model: string,
  runs: ReadonlyArray<{ grade: Grade; t: RunTranscript }>,
  meta: {
    passes: number;
    rate: number;
    threshold: number;
    totalCostUsd: number;
    unmatched: string[];
  },
): string {
  const header = [
    `\nScenario: ${scenario.name} [${surface}] (${scenario.dataset.name})`,
    `Model: ${model}   Query: "${scenario.query}"`,
    `Pass rate: ${meta.passes}/${runs.length} = ${(meta.rate * 100).toFixed(0)}% (need ${(meta.threshold * 100).toFixed(0)}%)   Cost: $${meta.totalCostUsd.toFixed(4)}`,
    ...(meta.unmatched.length > 0
      ? [`UNMATCHED BACKEND ROUTES (routing gap): ${[...new Set(meta.unmatched)].join(", ")}`]
      : []),
  ];
  return [...header, ...runs.flatMap((r, i) => formatRun(r, i))].join("\n");
}

function formatRun(r: { grade: Grade; t: RunTranscript }, i: number): string[] {
  const calls = r.t.toolCalls
    .map(
      (c) =>
        `${c.name}(${Object.keys(c.input).join(",")})${c.isError ? " ERR" : ""}${c.truncated ? " TRUNC" : ""}`,
    )
    .join(" → ");
  return [
    `\n--- run ${i + 1}: ${r.grade.pass ? "PASS" : "FAIL"} — ${r.grade.reason}`,
    ...(r.t.connected ? [] : ["  (!) surface did not connect/launch"]),
    ...(r.t.timedOut ? ["  (!) run timed out"] : []),
    `  calls: ${calls || "(none)"}`,
    r.t.evalReport ? indent(r.t.evalReport, "  ") : `  answer: ${r.t.answerText.slice(0, 280)}`,
  ];
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}

/**
 * The surfaces a scenario should run on: its declared surfaces (default both), intersected with the
 * EVAL_SURFACES env filter (comma-separated) when set — so `EVAL_SURFACES=mcp` runs only MCP.
 */
export function scenarioSurfaces(scenario: Scenario): Surface[] {
  const declared = scenario.surfaces ?? ["mcp", "cli"];
  const filter = process.env.EVAL_SURFACES;
  if (!filter) return declared;
  const wanted = new Set(filter.split(",").map((s) => s.trim()));
  return declared.filter((s) => wanted.has(s));
}

/** Whether the eval suites should run: opt-in flag set AND the claude CLI is available. */
export function evalGate(): { enabled: boolean; reason: string } {
  if (!process.env.RUN_EVALS && !process.env.RUN_MCP_EVALS) {
    return { enabled: false, reason: "set RUN_EVALS=1 to run the claude -p evals" };
  }
  const probe = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    return { enabled: false, reason: "claude CLI not found on PATH" };
  }
  return { enabled: true, reason: "" };
}
