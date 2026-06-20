import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import type { LibraryCache, LibrarySnapshot } from "./library-cache";

// Node-only helpers (filesystem). Imported via "@trainheroic-unofficial/js/node" by the
// CLI and local server; the runtime-agnostic "." entry never pulls node:fs.

/** Default exercise-cache path, overridable with TRAINHEROIC_CACHE_FILE. */
export function defaultCachePath(): string {
  return process.env.TRAINHEROIC_CACHE_FILE ?? join(homedir(), ".trainheroic", "library.json");
}

/** Persists the exercise library to a JSON file. */
export class JsonFileLibraryCache implements LibraryCache {
  readonly #path: string;

  constructor(path: string = defaultCachePath()) {
    this.#path = path;
  }

  async load(): Promise<LibrarySnapshot | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as LibrarySnapshot;
      if (typeof parsed.fetchedAt === "number" && Array.isArray(parsed.exercises)) return parsed;
    } catch {
      /* missing or corrupt cache: treat as no cache */
    }
    return null;
  }

  async save(snapshot: LibrarySnapshot): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, JSON.stringify(snapshot), { mode: 0o600 });
  }
}
