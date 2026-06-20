import { describe, expect, it } from "vitest";
import { confirmGate } from "../src/confirm";

type Server = Parameters<typeof confirmGate>[0];

function fakeServer(elicitInput: (...args: unknown[]) => Promise<unknown>): Server {
  return { server: { elicitInput } } as unknown as Server;
}

describe("confirmGate", () => {
  it("returns true on an explicit confirm flag without eliciting", async () => {
    let called = false;
    const server = fakeServer(async () => {
      called = true;
      return { action: "accept" };
    });
    expect(await confirmGate(server, "r1", "msg", true)).toBe(true);
    expect(called).toBe(false);
  });

  it("returns true when the user accepts via elicitation", async () => {
    const server = fakeServer(async () => ({ action: "accept", content: { confirm: true } }));
    expect(await confirmGate(server, "r1", "msg", undefined)).toBe(true);
  });

  it("returns false when elicitation is declined", async () => {
    const server = fakeServer(async () => ({ action: "decline" }));
    expect(await confirmGate(server, "r1", "msg", undefined)).toBe(false);
  });

  it("returns false when accepted but confirm is not true", async () => {
    const server = fakeServer(async () => ({ action: "accept", content: { confirm: false } }));
    expect(await confirmGate(server, "r1", "msg", undefined)).toBe(false);
  });

  it("fails closed when elicitation is unsupported (throws)", async () => {
    const server = fakeServer(async () => {
      throw new Error("elicitation not supported");
    });
    expect(await confirmGate(server, undefined, "msg", undefined)).toBe(false);
  });
});
