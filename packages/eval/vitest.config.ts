import { defineConfig } from "vitest/config";

// Each eval spawns a real `claude -p` subprocess against a fake backend, so runs are slow,
// nondeterministic, and must not contend for the same model concurrently. A single fork running
// one file at a time keeps cost bounded and the output legible; the per-scenario K-loop (not
// vitest retry) absorbs nondeterminism, so retry stays 0.
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts", "test/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
  },
});
