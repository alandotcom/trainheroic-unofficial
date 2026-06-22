// The CLI surface driver. Spawns `claude -p` with a generated `trainheroic` shim on PATH (scoped
// via the Bash(trainheroic:*) allow-rule) so the agent drives the CLI exactly as a user would. The
// shim runs the CLI directly via its tsx bin with the fake-backend base-URL overrides on its env,
// and blocks `--yes` so a read eval can never commit a write.

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCliCommand } from "../canonical";
import { pkgEntry, REPO_ROOT, tsxBin } from "../paths";
import { buildReadOnlyPrompt, CLI_PREAMBLE } from "../prompt";
import { spawnAndParse } from "../stream";
import type { Normalize } from "../stream";
import { DENIED_BUILTINS } from "../tools";
import type { Driver, RunOptions, RunTranscript } from "../types";

const DEFAULT_TIMEOUT_MS = 180_000;

const normalizeCli: Normalize = (rawName, input) => {
  if (rawName !== "Bash" || typeof input.command !== "string") return null;
  return normalizeCliCommand(input.command);
};

function shimContents(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
# Read-only eval: never let a write commit.
for a in "$@"; do
  case "$a" in
    --yes|-y) echo "cli-eval: read-only mode — --yes is blocked" >&2; exit 64 ;;
  esac
done
exec "${tsxBin("cli")}" "${pkgEntry("cli", "src/cli.ts")}" "$@"
`;
}

async function runOnce(
  url: string,
  query: string,
  today: string,
  opts: RunOptions,
): Promise<RunTranscript> {
  const dir = await mkdtemp(join(tmpdir(), "th-eval-cli-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const shimPath = join(binDir, "trainheroic");
  await writeFile(shimPath, shimContents(), "utf8");
  await chmod(shimPath, 0o755);

  // Empty MCP config so --strict-mcp-config loads no servers — this is a pure CLI run.
  const cfgPath = join(dir, "mcp.json");
  await writeFile(cfgPath, JSON.stringify({ mcpServers: {} }), "utf8");

  const args = [
    "-p",
    buildReadOnlyPrompt(query, today, CLI_PREAMBLE),
    "--model",
    opts.model,
    "--strict-mcp-config",
    "--mcp-config",
    cfgPath,
    "--setting-sources",
    "user",
    "--permission-mode",
    "default",
    "--allowed-tools",
    "Bash(trainheroic:*)",
    "--disallowed-tools",
    ...DENIED_BUILTINS,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    TRAINHEROIC_EMAIL: "fake-coach@example.com",
    TRAINHEROIC_PASSWORD: "fake-password",
    TH_COACH_BASE: url,
    TH_APIS_BASE: url,
    TH_AUTH_URL: `${url}/auth`,
    TRAINHEROIC_SESSION_FILE: join(dir, "session.json"),
    TRAINHEROIC_CACHE_FILE: join(dir, "library.json"),
  };

  try {
    return await spawnAndParse({
      surface: "cli",
      command: "claude",
      args,
      cwd: REPO_ROOT,
      env,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      normalize: normalizeCli,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const cliDriver: Driver = { surface: "cli", runOnce };
