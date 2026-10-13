import { z } from "zod";
import { safeEqual } from "./crypto";

const grantSchema = z.object({
  id: z.string(),
  userId: z.string().regex(/^[1-9]\d*$/u),
  clientId: z.string(),
  metadata: z.object({ label: z.email() }).optional(),
  expiresAt: z.number().optional(),
  authCodeId: z.string().optional(),
  authCodeWrappedKey: z.string().optional(),
  refreshTokenId: z.string().optional(),
  previousRefreshTokenId: z.string().optional(),
});

export type OAuthErrorIdentity = { userKey: string; email?: string };

/** Drain the diagnostic branch immediately so a request tee cannot buffer an unbounded body. */
export async function readOAuthErrorRequest(request: Request): Promise<Request | undefined> {
  try {
    const reader = request.body?.getReader();
    if (!reader) return;
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_384) {
        void reader.cancel().catch(() => {});
        return;
      }
      chunks.push(chunk.value);
    }
    return new Request(request.url, {
      method: request.method,
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: new Blob(chunks),
    });
  } catch {
    return undefined;
  }
}

// Provider 1.2.3 stores SHA-256 token hashes on grant records. This lookup is diagnostic only;
// it never changes the provider's authorization decision or decrypts grant props.
export async function oauthErrorIdentity(
  request: Request,
  kv: KVNamespace,
): Promise<OAuthErrorIdentity | undefined> {
  try {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/token") return;
    const bounded = await readOAuthErrorRequest(request);
    if (!bounded) return;
    const body = await bounded.formData();
    const single = (name: string) => {
      const values = body.getAll(name);
      return values.length === 1 && typeof values[0] === "string" ? values[0] : undefined;
    };
    const grantType = single("grant_type");
    if (grantType !== "refresh_token" && grantType !== "authorization_code") return;
    const token = single(grantType === "refresh_token" ? "refresh_token" : "code");
    const parts = token?.split(":");
    if (!token || parts?.length !== 3) return;
    const [userId, grantId, secret] = parts;
    if (!userId || !grantId || !secret || !/^[1-9]\d*$/u.test(userId)) return;
    const parsed = grantSchema.safeParse(await kv.get(`grant:${userId}:${grantId}`, "json"));
    if (!parsed.success) return;
    const grant = parsed.data;
    if (grant.userId !== userId || grant.id !== grantId || grant.clientId !== single("client_id")) {
      return;
    }
    if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now() / 1000 + 60) return;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const hashes =
      grantType === "refresh_token"
        ? [grant.refreshTokenId, grant.previousRefreshTokenId]
        : grant.authCodeWrappedKey
          ? [grant.authCodeId]
          : [];
    let matches = false;
    for (const storedHash of hashes) {
      if (storedHash && (await safeEqual(hash, storedHash))) matches = true;
    }
    if (!matches) return;
    return {
      userKey: `user:${userId}`,
      ...(grant.metadata ? { email: grant.metadata.label } : {}),
    };
  } catch {
    // Diagnostic failure must preserve the original OAuth response and its error report.
    return undefined;
  }
}
