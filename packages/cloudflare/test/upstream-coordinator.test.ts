import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainHeroicClient } from "@trainheroic-unofficial/js";
import { createAccountTransport, type TrainHeroicUpstream } from "../src/upstream-coordinator";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TrainHeroicUpstream", () => {
  it("maps every request for one account to the same Durable Object", () => {
    const first = env.TRAINHEROIC_UPSTREAM.getByName("204394");
    const second = env.TRAINHEROIC_UPSTREAM.getByName("204394");
    const other = env.TRAINHEROIC_UPSTREAM.getByName("204395");

    expect(first.id.equals(second.id)).toBe(true);
    expect(first.id.equals(other.id)).toBe(false);
  });

  it("allows at most four upstream requests in flight for one account", async () => {
    const firstTransport = createAccountTransport(env.TRAINHEROIC_UPSTREAM, 204394);
    const secondTransport = createAccountTransport(env.TRAINHEROIC_UPSTREAM, 204394);
    const intervals = await Promise.all(
      Array.from({ length: 9 }, async (_, i) => {
        const response = await (i % 2 === 0 ? firstTransport : secondTransport)(
          `https://api.trainheroic.com/__coordinator_test/${i}`,
          { method: "GET", headers: { accept: "application/json" } },
        );
        return (await response.json()) as { startedAt: number; endedAt: number };
      }),
    );

    const events = intervals
      .flatMap(({ startedAt, endedAt }) => [
        { at: startedAt, delta: 1 },
        { at: endedAt, delta: -1 },
      ])
      .sort((left, right) => left.at - right.at || left.delta - right.delta);
    let active = 0;
    let peak = 0;
    for (const event of events) {
      active += event.delta;
      peak = Math.max(peak, active);
    }
    expect(peak).toBe(4);
  });

  it("releases a slot when the upstream fetch rejects", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("synthetic upstream failure"))
      .mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const stub = env.TRAINHEROIC_UPSTREAM.getByName("204396");

    await runInDurableObject(stub, async (instance: TrainHeroicUpstream) => {
      await expect(
        instance.dispatch({
          url: "https://api.trainheroic.com/v5/fail",
          method: "GET",
          headers: [],
        }),
      ).rejects.toThrow(/synthetic upstream failure/u);

      await Promise.all(
        Array.from({ length: 4 }, async (_, i) => {
          const response = await instance.dispatch({
            url: `https://api.trainheroic.com/v5/recovery-${i}`,
            method: "GET",
            headers: [],
          });
          await response.text();
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("cancels discarded 401 streams before session renewal", async () => {
    const transport = createAccountTransport(env.TRAINHEROIC_UPSTREAM, 204398);
    const client = new TrainHeroicClient("a@b.com", "pw", "stale-session", { transport });

    const results = await Promise.race([
      Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          client.request<{ ok?: boolean }>("GET", `/__coordinator_test/relogin/${i}`),
        ),
      ),
      new Promise<"timed out">((resolve) => {
        setTimeout(() => resolve("timed out"), 1_000);
      }),
    ]);

    expect(results).not.toBe("timed out");
    expect(client.sessionId).toBe("fresh-session");
    expect((results as Array<{ ok: boolean }>).every((result) => result.ok)).toBe(true);
  });

  it("rejects non-TrainHeroic origins", async () => {
    const stub = env.TRAINHEROIC_UPSTREAM.getByName("204397");
    await runInDurableObject(stub, async (instance: TrainHeroicUpstream) => {
      await expect(
        instance.dispatch({ url: "https://example.com/private", method: "GET", headers: [] }),
      ).rejects.toThrow(/only accepts TrainHeroic API URLs/u);
    });
  });
});
