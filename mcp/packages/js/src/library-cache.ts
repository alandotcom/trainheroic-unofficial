/** A persisted snapshot of the exercise library: the raw rows plus when they were fetched. */
export type LibrarySnapshot = {
  fetchedAt: number;
  exercises: Array<Record<string, unknown>>;
};

/**
 * Where ExerciseLibrary persists the library between runs. Abstracted so the library
 * logic stays runtime-agnostic; the Node JSON-file backend is in the "./node" subpath.
 */
export interface LibraryCache {
  load(): Promise<LibrarySnapshot | null>;
  save(snapshot: LibrarySnapshot): Promise<void>;
}

/** In-memory cache (no persistence). The default when none is supplied. */
export class MemoryLibraryCache implements LibraryCache {
  #snapshot: LibrarySnapshot | null = null;

  async load(): Promise<LibrarySnapshot | null> {
    return this.#snapshot;
  }

  async save(snapshot: LibrarySnapshot): Promise<void> {
    this.#snapshot = snapshot;
  }
}
