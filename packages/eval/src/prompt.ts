// The driver prompt, shared by both surfaces and both modes. The preamble names the surface (MCP
// tools vs the `trainheroic` CLI); the constraints block flips between read-only and write; the task
// and EVAL REPORT format are identical so every (role, surface, mode) answers under the same rules.

import { EVAL_REPORT_END, EVAL_REPORT_START } from "./types";
import type { Mode } from "./types";

const READ_CONSTRAINTS = `HARD CONSTRAINTS — this is a read-only evaluation:
- Never take an action that writes, logs, creates, modifies, deletes, sends, or publishes
  anything. Only read/query/list operations are allowed.
- If the request is ambiguous (several things could match), ask a clarifying question
  rather than guessing — that is a valid and often correct outcome.`;

const WRITE_CONSTRAINTS = `MODE — write eval against a disposable TEST account:
- You MAY use write tools (log, prescribe, create, swap, invite, etc.) to actually carry out the
  task. The account is disposable, so perform the action for real rather than describing it.
- If a tool asks for confirmation, pass its confirm argument (confirm:true) — there is no
  interactive prompt here. On the CLI, pass --yes.
- Do NOT touch data the task did not ask you to change.`;

export function buildPrompt(
  query: string,
  today: string,
  surfacePreamble: string,
  role: "coach" | "athlete",
  mode: Mode,
): string {
  const owner =
    role === "coach" ? "the coach who owns this account" : "the athlete (account owner)";
  return `${surfacePreamble}

CONTEXT: Today's date is ${today}. You are assisting ${owner}.

${mode === "write" ? WRITE_CONSTRAINTS : READ_CONSTRAINTS}

YOUR TASK: Answer this question as naturally and correctly as you can, grounded in real results.
Work like a real assistant — explore, recover from dead ends, and when a result is large or
truncated, narrow it (filter, paginate, or pick a more specific id) instead of giving up:
"${query}"

Then output a delimited report for the developer in EXACTLY this format:

${EVAL_REPORT_START}
QUERY: "${query}"
FINAL_ANSWER: <one-paragraph summary of what you concluded>
ANSWER_REACHED: yes | partial | no
CALLS (in order, one per line): <n>. <tool-or-command> | args: <key args> | outcome: <useful / empty / error / wrong-direction>
TOTAL_CALLS: <number>
DEAD_ENDS_AND_BACKTRACKS: <each call that did not help, wrong choice, or reconsideration — and why>
CONFUSION_POINTS: <where names/descriptions/output were ambiguous or misleading>
WHAT_WOULD_HAVE_HELPED: <concrete name/description/param changes that would have been faster>
CONFUSION_SCORE: <1=effortless to 5=very confusing>
${EVAL_REPORT_END}

Be brutally honest in the report — its purpose is to find usability problems.`;
}

export function mcpPreamble(prefix: string): string {
  return (
    "You are role-playing a general AI assistant connected to the TrainHeroic MCP. Its tools are " +
    `named ${prefix}* . Use whatever TrainHeroic tools you need.`
  );
}

export function cliPreamble(role: "coach" | "athlete"): string {
  const group = role === "coach" ? "`trainheroic coach`" : "`trainheroic athlete`";
  return (
    "You are role-playing a general AI assistant with a `trainheroic` command-line tool on PATH " +
    "(run it via Bash). Discover commands by running `trainheroic` with no arguments, and " +
    `${group} for the ${role} subcommands. Use whatever \`trainheroic\` commands you need.`
  );
}
