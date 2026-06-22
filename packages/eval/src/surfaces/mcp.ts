// The MCP surface driver. Spawns `claude -p` against the local coach stdio MCP server, which runs
// directly via its tsx bin (no shell launcher, no pnpm overhead) with the fake-backend base-URL
// overrides injected on the server's env — so the real .env never loads and traffic stays local.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkgEntry, REPO_ROOT, tsxBin } from "../paths";
import { buildReadOnlyPrompt, MCP_PREAMBLE } from "../prompt";
import { spawnAndParse } from "../stream";
import type { Normalize } from "../stream";
import {
  COACH_PREFIX,
  COACH_READ_TOOLS,
  COACH_SERVER,
  COACH_WRITE_TOOLS,
  DENIED_BUILTINS,
  prefixed,
} from "../tools";
import type { Driver, RunOptions, RunTranscript } from "../types";

const DEFAULT_TIMEOUT_MS = 180_000;

const normalizeMcp: Normalize = (rawName, input) => {
  const name = rawName.startsWith(COACH_PREFIX) ? rawName.slice(COACH_PREFIX.length) : rawName;
  return { name, input };
};

async function runOnce(
  url: string,
  query: string,
  today: string,
  opts: RunOptions,
): Promise<RunTranscript> {
  const dir = await mkdtemp(join(tmpdir(), "th-eval-mcp-"));
  const cfgPath = join(dir, "mcp.json");
  const config = {
    mcpServers: {
      [COACH_SERVER]: {
        command: tsxBin("coach-mcp"),
        args: [pkgEntry("coach-mcp", "src/server.ts")],
        env: {
          TRAINHEROIC_EMAIL: "fake-coach@example.com",
          TRAINHEROIC_PASSWORD: "fake-password",
          TH_COACH_BASE: url,
          TH_APIS_BASE: url,
          TH_AUTH_URL: `${url}/auth`,
          TRAINHEROIC_CACHE_FILE: join(dir, "library.json"),
        },
      },
    },
  };
  await writeFile(cfgPath, JSON.stringify(config), "utf8");

  const args = [
    "-p",
    buildReadOnlyPrompt(query, today, MCP_PREAMBLE),
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
    ...prefixed(COACH_READ_TOOLS),
    "--disallowed-tools",
    ...DENIED_BUILTINS,
    "Bash",
    ...prefixed(COACH_WRITE_TOOLS),
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  try {
    return await spawnAndParse({
      surface: "mcp",
      command: "claude",
      args,
      cwd: REPO_ROOT,
      env: process.env,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      normalize: normalizeMcp,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const mcpDriver: Driver = { surface: "mcp", runOnce };
