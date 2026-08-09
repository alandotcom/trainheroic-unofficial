import { describe, expect, it } from "vitest";
import { shouldRevokeExistingGrants } from "../src/auth/oauth-provider-compat";

describe("OAuth provider compatibility policy", () => {
  it.each([
    ["https://client.example/oauth/client.json", false],
    ["HTTPS://client.example/oauth/client.json", false],
    ["https://client.example?metadata=1", true],
    ["http://client.example/oauth/client.json", true],
    ["generated-dcr-client-id", true],
  ])("sets the grant-revocation policy for %s", (clientId, expected) => {
    expect(shouldRevokeExistingGrants(clientId)).toBe(expected);
  });
});
