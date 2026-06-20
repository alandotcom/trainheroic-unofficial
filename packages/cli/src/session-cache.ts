import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

// Each CLI invocation is a fresh process, so persist the TrainHeroic session token to
// avoid logging in on every command. On a 401 the client re-logs-in and updates its
// session, which we then save back. Path overridable with TRAINHEROIC_SESSION_FILE.
const TTL_MS = 6 * 3600 * 1000;

function sessionPath(): string {
  return process.env.TRAINHEROIC_SESSION_FILE ?? join(homedir(), ".trainheroic", "session.json");
}

export async function loadSession(): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(sessionPath(), "utf8")) as {
      sessionId?: string;
      savedAt?: number;
    };
    if (
      typeof data.sessionId === "string" &&
      typeof data.savedAt === "number" &&
      Date.now() - data.savedAt < TTL_MS
    ) {
      return data.sessionId;
    }
  } catch {
    /* no or invalid session cache */
  }
  return null;
}

export async function saveSession(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  const p = sessionPath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ sessionId, savedAt: Date.now() }), { mode: 0o600 });
}
