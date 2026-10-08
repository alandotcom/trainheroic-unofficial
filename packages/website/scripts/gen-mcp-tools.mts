/**
 * Generate the Blume MCP tool catalog from the eval tool lists and
 * mcp-tool-catalog.ts. Run via `pnpm gen:mcp-tools` (also runs before build).
 *
 * Each row's Access badge comes from the tool's registered MCP annotations: the script registers
 * the core coach and athlete tools against a stub server that records each tool's annotations.
 * Every core tool annotated `destructiveHint: true` is gated by `confirmGate`, so the badge tells
 * a reader which tools ask before they act.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATHLETE_READ_TOOLS,
  ATHLETE_WRITE_TOOLS,
  COACH_READ_TOOLS,
  COACH_WRITE_TOOLS,
} from "../../eval/src/tools.ts";
import { registerAthleteTrainingTools, registerCoachTools } from "../../core/src/index.ts";
import {
  ATHLETE_GROUP_NAMES,
  COACH_GROUP_NAMES,
  HOSTED_ONLY_TOOL_ACCESS,
  HOSTED_ONLY_TOOL_NAMES,
  TOOL_SUMMARIES,
} from "../src/data/mcp-tool-catalog.ts";

const scriptDir = import.meta.dirname;
const outPath = join(scriptDir, "../src/content/docs/developers/mcp/02-tools.mdx");

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function assertSetMatches(
  label: string,
  expected: readonly string[],
  grouped: { title: string; tools: string[] }[],
): void {
  const fromGroups = grouped.flatMap((g) => g.tools);
  const expectedSet = new Set(expected);
  const groupedSet = new Set(fromGroups);

  const missing = expected.filter((t) => !groupedSet.has(t));
  const extra = fromGroups.filter((t) => !expectedSet.has(t));
  const dupes = fromGroups.filter((t, i) => fromGroups.indexOf(t) !== i);

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing from groups: ${missing.join(", ")}`);
  if (extra.length > 0) problems.push(`unknown in groups: ${extra.join(", ")}`);
  if (dupes.length > 0) problems.push(`duplicates in groups: ${unique(dupes).join(", ")}`);
  if (problems.length > 0) {
    throw new Error(`${label} catalog mismatch — ${problems.join("; ")}`);
  }
}

function summary(name: string): string {
  const text = TOOL_SUMMARIES[name];
  if (!text) throw new Error(`Missing TOOL_SUMMARIES entry for "${name}"`);
  return text;
}

type Access = "read" | "write" | "confirm";

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/**
 * Register the core tools against a stand-in for McpServer that keeps only each tool's
 * annotations. Registration does not call the client or the exercise index (handlers do, and
 * they never run here), so empty stand-ins are enough.
 */
function coreToolAccess(): Map<string, Access> {
  const access = new Map<string, Access>();
  const recorder = {
    registerTool(name: string, config: { annotations?: ToolAnnotations }) {
      const hints = config.annotations ?? {};
      access.set(name, hints.readOnlyHint ? "read" : hints.destructiveHint ? "confirm" : "write");
    },
  };
  type Server = Parameters<typeof registerCoachTools>[0];
  registerCoachTools(recorder as unknown as Server, { client: {}, index: {} } as never);
  registerAthleteTrainingTools(recorder as unknown as Server, { client: {} } as never);
  return access;
}

const CORE_ACCESS = coreToolAccess();

function accessOf(name: string): Access {
  const hosted = (HOSTED_ONLY_TOOL_ACCESS as Record<string, Access>)[name];
  const access = hosted ?? CORE_ACCESS.get(name);
  if (!access) throw new Error(`No registered annotations for "${name}"`);
  return access;
}

const BADGES: Record<Access, string> = {
  read: "<Badge>Read</Badge>",
  write: '<Badge variant="accent">Writes</Badge>',
  confirm: '<Badge variant="warning">Confirms</Badge>',
};

interface Row {
  name: string;
  summary: string;
  access: Access;
}

const row = (name: string): Row => ({ name, summary: summary(name), access: accessOf(name) });

function buildGroups(groups: { title: string; tools: string[] }[]) {
  return groups.map((group) => ({ title: group.title, tools: group.tools.map(row) }));
}

const coachTools = unique([...COACH_READ_TOOLS, ...COACH_WRITE_TOOLS]);
const athleteTools = unique([...ATHLETE_READ_TOOLS, ...ATHLETE_WRITE_TOOLS]);

assertSetMatches("coach", coachTools, COACH_GROUP_NAMES);
assertSetMatches("athlete", athleteTools, ATHLETE_GROUP_NAMES);

for (const name of [...coachTools, ...athleteTools, ...HOSTED_ONLY_TOOL_NAMES]) {
  summary(name);
}

const coachGroups = buildGroups(COACH_GROUP_NAMES);
const athleteGroups = buildGroups(ATHLETE_GROUP_NAMES);
const hostedOnly = HOSTED_ONLY_TOOL_NAMES.map(row);

const table = (tools: Row[]) =>
  [
    "| Tool | What it does | Access |",
    "| --- | --- | --- |",
    ...tools.map(
      ({ name, summary: description, access }) =>
        `| \`${name}\` | ${description} | ${BADGES[access]} |`,
    ),
  ].join("\n");

const groups = (items: { title: string; tools: Row[] }[]) =>
  items.map(({ title, tools }) => `### ${title}\n\n${table(tools)}`).join("\n\n");

const allRows = [...coachGroups, ...athleteGroups].flatMap((g) => g.tools).concat(hostedOnly);
const count = (access: Access) => allRows.filter((r) => r.access === access).length;

const source = `---
title: Tool catalog
description: Every TrainHeroic MCP tool for coaches and athletes, grouped by task, with which tools only read and which ask before changing data.
sidebar:
  order: 3
search:
  keywords: [tools, tool list, confirmation, destructive, read-only, annotations]
related:
  - /capabilities
  - /developers/mcp/local
---

{/* Generated by scripts/gen-mcp-tools.mts. Do not edit by hand. */}

The model chooses these tools from your request. Your MCP client shows each tool's full input
schema before it runs.

The Access column comes from each tool's MCP annotations:

- ${BADGES.read} marks the ${count("read")} tools that only read data.
- ${BADGES.write} marks the ${count("write")} tools that make additive or reversible changes, such as creating a program, restoring an athlete, or syncing history. They run without a prompt.
- ${BADGES.confirm} marks the ${count("confirm")} tools that edit or remove existing data, publish, send, or log results. The server asks you to approve each call and refuses the call without approval.

\`workout_build\` also asks for approval when you ask it to publish in the same call.

## Coach tools

Available to coach accounts on the main hosted endpoint and from the local coach server.

${groups(coachGroups)}

## Athlete tools

Available to every account on the main hosted endpoint and from both local servers.

${groups(athleteGroups)}

## Hosted-only tools

These use the hosted server's D1 warehouse or feedback service.

${table(hostedOnly)}
`;

writeFileSync(outPath, source);
console.log(`Wrote ${outPath}`);
