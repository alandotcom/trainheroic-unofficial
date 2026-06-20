import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomToken,
  signPayload,
  verifyPayload,
} from "../src/auth/crypto";

const SECRET = "test-secret-key";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64, 7]);
    expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toEqual([...bytes]);
  });

  it("emits only url-safe characters", () => {
    const s = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(48)));
    expect(s).not.toMatch(/[+/=]/u);
  });
});

describe("signed payloads", () => {
  it("round-trips and verifies", async () => {
    const token = await signPayload({ a: 1, b: "x", c: [1, 2] }, SECRET);
    expect(await verifyPayload(token, SECRET)).toEqual({ a: 1, b: "x", c: [1, 2] });
  });

  it("rejects a tampered body", async () => {
    const token = await signPayload({ a: 1 }, SECRET);
    const dot = token.indexOf(".");
    const body = token.slice(0, dot);
    const flipped = body.slice(0, -1) + (body.at(-1) === "A" ? "B" : "A");
    expect(await verifyPayload(`${flipped}${token.slice(dot)}`, SECRET)).toBeNull();
  });

  it("rejects the wrong secret", async () => {
    const token = await signPayload({ a: 1 }, SECRET);
    expect(await verifyPayload(token, "other-secret")).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifyPayload("no-dot-here", SECRET)).toBeNull();
  });
});

describe("randomToken", () => {
  it("is unique and url-safe", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken(16)).not.toMatch(/[+/=]/u);
  });
});
