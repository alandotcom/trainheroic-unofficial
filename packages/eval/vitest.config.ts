import { defineConfig } from "vitest/config";
import { CONCURRENCY } from "./src/limit";

// Each eval spawns a real `claude -p` subprocess against a fake backend. How many of those run at
// once is decided by the EVAL_CONCURRENCY gate in src/limit.ts, not by vitest — so everything here
// stays in ONE worker (maxWorkers 1, no file parallelism), which is what makes that gate global.
// The parallelism comes from two places that both feed the same gate: runScenario fires its K runs
// at once, and the eval suites declare themselves `describe.…concurrent` so tests overlap. The
// deterministic test/** suites are untouched by that — they stay sequential and share one backend
// handle.
//
// maxConcurrency tracks the gate width so the gate can be filled from tests alone. That matters at
// EVAL_K=1, where each test contributes a single run: at a narrower setting a smoke run would idle
// most of the gate. It is bounded rather than unlimited because a test's clock runs while its work
// waits in the queue, so the timeouts below have to cover the worst-case wait — with both knobs at
// 5 that is about six run-lengths, well inside 30 minutes. The per-scenario K-loop (not vitest
// retry) absorbs nondeterminism, so retry stays 0.
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts", "test/**/*.test.ts"],
    // A single run is SIGKILLed at 180s by the drivers; the rest is headroom for queue wait.
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: CONCURRENCY,
    retry: 0,
  },
});
