const DEFAULT_AUTH_URL = "https://apis.trainheroic.com/auth";

/**
 * The login endpoint, allowing an env override so a test harness can authenticate against a local
 * fake backend. Precedence: an explicit `TH_AUTH_URL`, else `${TH_APIS_BASE}/auth` (login lives on
 * the apis host, so it follows that base), else the real endpoint. Read via `globalThis.process`
 * (no `import process`) to keep this module workerd-safe, and per call so a child-env override wins.
 */
function authUrl(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (env?.TH_AUTH_URL && env.TH_AUTH_URL.length > 0) return env.TH_AUTH_URL;
  const apis = env?.TH_APIS_BASE;
  if (apis && apis.length > 0) return `${apis.replace(/\/$/, "")}/auth`;
  return DEFAULT_AUTH_URL;
}

export type TrainHeroicSession = {
  thUserId: number;
  sessionId: string;
  scope: string;
  role: string;
};

type AuthResponse = {
  id?: number;
  session_id?: string;
  scope?: string;
  role?: string;
};

/**
 * Authenticate against TrainHeroic. Returns the session bundle, or null on bad
 * credentials. TrainHeroic returns only { id, scope, role, session_id } (verified in
 * the Phase 0 spike: no refresh_token, no api_token, no TTL). The 48-char session_id
 * is sent as the `session-token` header and works against both API hosts.
 */
export async function loginTrainHeroic(
  email: string,
  password: string,
): Promise<TrainHeroicSession | null> {
  const res = await fetch(authUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ email, password }).toString(),
  });

  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as AuthResponse | null;
  if (!data || typeof data.id !== "number" || !data.session_id) return null;

  return {
    thUserId: data.id,
    sessionId: data.session_id,
    scope: data.scope ?? "",
    role: data.role ?? "",
  };
}
