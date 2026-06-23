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

/**
 * Authenticated TrainHeroic API client. Holds the coach credentials (from the grant's
 * encrypted props) and a lazily-acquired session token cached in memory for the life
 * of the Durable Object instance. On a 401/403 it re-logs in once and retries, since
 * TrainHeroic has no refresh token and sessions expire after ~1-2h.
 */
export class TrainHeroicClient {
  readonly #email: string;
  readonly #password: string;
  #sessionId: string | null;
  #loginInFlight: Promise<string> | null = null;

  constructor(email: string, password: string, sessionId: string | null = null) {
    this.#email = email;
    this.#password = password;
    this.#sessionId = sessionId;
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
