import { loginTrainHeroic } from "./auth";

const COACH_BASE = "https://api.trainheroic.com";
const APIS_BASE = "https://apis.trainheroic.com";

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
    const base = options.base === "apis" ? APIS_BASE : COACH_BASE;
    const url = `${base}/${path.replace(/^\//, "")}`;

    let session = await this.#ensureSession();
    let res = await this.#send(method, url, session, options.body);

    if (res.status === 401 || res.status === 403) {
      this.#sessionId = null;
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
