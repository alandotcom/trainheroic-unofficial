const AUTH_URL = "https://apis.trainheroic.com/auth";

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
  const res = await fetch(AUTH_URL, {
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
