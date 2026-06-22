// The MCP surface driver. Spawns `claude -p` against the role's local stdio MCP server, which runs
// directly via its tsx bin (no shell launcher, no pnpm overhead) with the fake-backend base-URL
// overrides injected on the server's env — so the real .env never loads and traffic stays local.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkgEntry, REPO_ROOT, tsxBin } from "../paths";
import { buildPrompt, mcpPreamble } from "../prompt";
import { spawnAndParse } from "../stream";
import type { Normalize } from "../stream";
import { DENIED_BUILTINS, prefixed, ROLE_TOOLS } from "../tools";
import type { Driver, Role, RunOptions, RunTranscript } from "../types";

const DEFAULT_TIMEOUT_MS = 180_000;

function makeRunOnce(role: Role) {
  const cfg = ROLE_TOOLS[role];
  const normalize: Normalize = (rawName, input) => {
    const name = rawName.startsWith(cfg.prefix) ? rawName.slice(cfg.prefix.length) : rawName;
    return { name, input };
  };

  return async function runOnce(
    url: string,
    query: string,
    today: string,
    opts: RunOptions,
  ): Promise<RunTranscript> {
    const dir = await mkdtemp(join(tmpdir(), `th-eval-mcp-${role}-`));
    const cfgPath = join(dir, "mcp.json");
    const config = {
      mcpServers: {
        [cfg.server]: {
          command: tsxBin(cfg.pkg),
          args: [pkgEntry(cfg.pkg, "src/server.ts")],
          env: {
            TRAINHEROIC_EMAIL: `fake-${role}@example.com`,
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

    // In write mode the write tools are allowed; in read mode they are denied (belt and suspenders
    // with the read-only prompt) so a write can never fire even if the model tries.
    const writeAllow = opts.mode === "write" ? prefixed(cfg.prefix, cfg.writeTools) : [];
    const writeDeny = opts.mode === "write" ? [] : prefixed(cfg.prefix, cfg.writeTools);
    const args = [
      "-p",
      buildPrompt(query, today, mcpPreamble(cfg.prefix), role, opts.mode),
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
      ...prefixed(cfg.prefix, cfg.readTools),
      ...writeAllow,
      "--disallowed-tools",
      ...DENIED_BUILTINS,
      "Bash",
      ...writeDeny,
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
        normalize,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

export function mcpDriver(role: Role): Driver {
  return { surface: "mcp", runOnce: makeRunOnce(role) };
}
