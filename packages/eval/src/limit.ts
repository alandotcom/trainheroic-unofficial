// A process-global concurrency gate for eval runs. Every run spawns a real `claude` process (which
// in turn spawns an MCP server or the CLI), so the suite's cost and rate-limit exposure scale with
// how many are alive at once — not with how many vitest has open. One module-level semaphore, sized
// by EVAL_CONCURRENCY, is the single place that decides that number. Because the eval suite runs in
// one vitest worker (see vitest.config.ts), this module instance governs the whole run.

const DEFAULT_CONCURRENCY = 5;

/** How many runs may be in flight at once. Read once at import; EVAL_CONCURRENCY overrides. */
export const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY) || DEFAULT_CONCURRENCY;

let active = 0;
/** Callers waiting for a slot, in arrival order — resolve one per release, so the queue is FIFO. */
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
  });
  // release() handed this waiter the slot without decrementing, so `active` already counts it.
}

function release(): void {
  const next = waiting.shift();
  // Hand the slot straight to the next waiter rather than freeing it first — a decrement here would
  // let a caller arriving in the same tick slip past the cap alongside the waiter it woke.
  if (next) next();
  else active -= 1;
}

/**
 * Run `fn` once a slot is free. Wrap the *whole* unit of work (boot the fake backend → spawn claude
 * → grade → close), not just the spawn: queued work must hold no sockets or temp dirs while it
 * waits, or a large suite would open hundreds of listeners before the first run finishes.
 */
export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
