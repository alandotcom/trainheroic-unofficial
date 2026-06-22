// The read-only driver prompt, shared by both surfaces. The only difference is the preamble that
// names the surface (MCP tools vs the `trainheroic` CLI); the task, constraints, and EVAL REPORT
// format are identical so the two surfaces answer the same question under the same rules.

import { EVAL_REPORT_END, EVAL_REPORT_START } from "./types";

export function buildReadOnlyPrompt(query: string, today: string, surfacePreamble: string): string {
  return `${surfacePreamble}

CONTEXT: Today's date is ${today}. You are assisting the coach who owns this account.

HARD CONSTRAINTS — this is a read-only evaluation:
- Never take an action that writes, logs, creates, modifies, deletes, sends, or publishes
  anything. Only read/query/list operations are allowed.
- If the request is ambiguous (several things could match), ask the coach a clarifying question
  rather than guessing — that is a valid and often correct outcome.

YOUR TASK: Answer this question as naturally and correctly as you can, grounded in real results.
Work like a real assistant — explore, recover from dead ends, and when a result is large or
truncated, narrow it (filter, paginate, or pick a more specific id) instead of giving up:
"${query}"

Then output a delimited report for the developer in EXACTLY this format:

${EVAL_REPORT_START}
QUERY: "${query}"
FINAL_ANSWER: <one-paragraph summary of what you concluded for the coach>
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

export const MCP_PREAMBLE =
  "You are role-playing a general AI assistant connected to the TrainHeroic MCP. Its tools are " +
  "named mcp__trainheroic-local-coach__* . Use whatever TrainHeroic tools you need.";

export const CLI_PREAMBLE =
  "You are role-playing a general AI assistant with a `trainheroic` command-line tool on PATH " +
  "(run it via Bash). Discover commands by running `trainheroic` with no arguments, and " +
  "`trainheroic coach` for the coach subcommands. Use whatever `trainheroic` commands you need.";
