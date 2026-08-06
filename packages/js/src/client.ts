import { loginTrainHeroic } from "./auth";

const DEFAULT_COACH_BASE = "https://api.trainheroic.com";
const DEFAULT_APIS_BASE = "https://apis.trainheroic.com";

/**
 * Resolve an API host, allowing an env override. The override exists so a test harness can point
 * the client at a local fake backend (and it doubles as a staging knob); production leaves these
 * unset and gets the real hosts. Read through `globalThis.process?.env` — not an `import process`
 * — so the runtime-agnostic `.` entry stays free of `node:*` and runs unchanged on workerd, and
 * read per request (not at module load) so a value the harness sets in the child env always wins.
 */
function envBase(key: string, fallback: string): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const v = env?.[key];
  return v && v.length > 0 ? v : fallback;
}

export class TrainHeroicAuthError extends Error {
  override name = "TrainHeroicAuthError";
}

export type ApiBase = "coach" | "apis";

export type RequestOptions = {
  body?: unknown;
  base?: ApiBase;
};

export type ClientResult<T = unknown> = {
  status: number;
  ok: boolean;
  data: T;
};

export type ClientOptions = {
  /**
   * Called with each newly acquired session token — the cold login and the post-401 re-login
   * both fire it. Callers that outlive the client (the hosted Worker's per-request factory, the
   * CLI's on-disk cache) use this to hold the token, so the next client can be seeded with it
   * instead of logging in again.
   */
  onSession?: (sessionId: string) => void;
};

/**
 * Authenticated TrainHeroic API client. Holds the credentials (on the hosted Worker, from the
 * grant's encrypted props) and a lazily-acquired session token cached in memory for the life of
 * *this client instance* — nothing longer. On a 401/403 it re-logs in once and retries, since
 * TrainHeroic has no refresh token and sessions expire after ~1-2h.
 *
 * Anything that wants a session to outlive one client owns that itself: pass a previously
 * acquired token as `sessionId` and keep the new one via `options.onSession`. That matters
 * wherever clients are short-lived — the hosted Worker builds one per HTTP request, and each CLI
 * invocation is a fresh process — because otherwise every operation replays the password.
 */
export class TrainHeroicClient {
  readonly #email: string;
  readonly #password: string;
  readonly #onSession: ((sessionId: string) => void) | undefined;
  #sessionId: string | null;
  #loginInFlight: Promise<string> | null = null;

  constructor(
    email: string,
    password: string,
    sessionId: string | null = null,
    options: ClientOptions = {},
  ) {
    this.#email = email;
    this.#password = password;
    this.#sessionId = sessionId;
    this.#onSession = options.onSession;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  async #ensureSession(): Promise<string> {
    if (this.#sessionId) return this.#sessionId;
    // Dedup concurrent logins (a cold client under Promise.all would otherwise fire
    // one /auth per in-flight request); all callers share one login promise.
    this.#loginInFlight ??= this.#login();
    try {
      return await this.#loginInFlight;
    } finally {
      this.#loginInFlight = null;
    }
  }

  async #login(): Promise<string> {
    const session = await loginTrainHeroic(this.#email, this.#password);
    if (!session) throw new TrainHeroicAuthError("TrainHeroic login failed");
    this.#sessionId = session.sessionId;
    // Never let a caller's cache bookkeeping break the request that acquired the token.
    try {
      this.#onSession?.(this.#sessionId);
    } catch {
      /* ignore */
    }
    return this.#sessionId;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ClientResult<T>> {
    const base =
      options.base === "apis"
        ? envBase("TH_APIS_BASE", DEFAULT_APIS_BASE)
        : envBase("TH_COACH_BASE", DEFAULT_COACH_BASE);
    const url = `${base}/${path.replace(/^\//, "")}`;

    let session = await this.#ensureSession();
    let res = await this.#send(method, url, session, options.body);

    if (res.status === 401 || res.status === 403) {
      // Invalidate only if no concurrent request already swapped in a fresh session;
      // otherwise a late 401 responder would wipe a good token and re-trigger login.
      if (this.#sessionId === session) this.#sessionId = null;
      session = await this.#ensureSession();
      res = await this.#send(method, url, session, options.body);
    }

    const text = await res.text();
    let data: unknown = text;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return { status: res.status, ok: res.ok, data: data as T };
  }

  #send(method: string, url: string, session: string, body?: unknown): Promise<Response> {
    const upper = method.toUpperCase();
    const headers: Record<string, string> = {
      accept: "application/json",
      "session-token": session,
    };
    const init: RequestInit = { method: upper, headers };
    if (body !== undefined && upper !== "GET" && upper !== "DELETE") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(url, init);
  }
}
