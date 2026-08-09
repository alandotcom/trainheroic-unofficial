import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Props } from "../types";

/**
 * Compatibility boundary for workers-oauth-provider 0.10.2.
 *
 * The provider does not expose whether a resolved client came from CIMD or dynamic
 * registration. Its 0.10.2 implementation recognizes an HTTPS client ID with an explicit
 * path as CIMD. Keep that dependency-specific rule here, and keep the package version pinned,
 * so a provider upgrade has one obvious contract to re-audit.
 */
export function shouldRevokeExistingGrants(clientId: string): boolean {
  try {
    const parsed = new URL(clientId);
    if (parsed.protocol !== "https:") return true;

    const authorityStart = clientId.indexOf("://") + 3;
    const pathStart = clientId.indexOf("/", authorityStart);
    const queryStart = clientId.search(/[?#]/u);
    const hasExplicitPath =
      pathStart >= authorityStart && (queryStart === -1 || pathStart < queryStart);
    return !hasExplicitPath;
  } catch {
    return true;
  }
}

export async function completeTrainHeroicAuthorization(
  provider: Pick<OAuthHelpers, "completeAuthorization">,
  request: AuthRequest,
  props: Props,
): Promise<string> {
  const { redirectTo } = await provider.completeAuthorization({
    request,
    userId: String(props.thUserId),
    metadata: { label: props.email },
    scope: request.scope,
    props,
    // A CIMD client ID identifies the client build, not one installation. Revoking by
    // user+client would log the same user out on every other device. DCR clients keep stale-grant
    // cleanup because each installation has its own generated client ID.
    revokeExistingGrants: shouldRevokeExistingGrants(request.clientId),
  });
  return redirectTo;
}
