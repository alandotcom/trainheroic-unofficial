import { DurableObject } from "cloudflare:workers";
import type { TrainHeroicTransport } from "@trainheroic-unofficial/js";

const MAX_ACCOUNT_CONCURRENCY = 4;
const TRAINHEROIC_ORIGINS = new Set([
  "https://api.trainheroic.com",
  "https://apis.trainheroic.com",
]);

export type UpstreamRequest = {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
};

function trainHeroicUrl(raw: string): URL {
  const url = new URL(raw);
  if (!TRAINHEROIC_ORIGINS.has(url.origin)) {
    throw new TypeError("The upstream coordinator only accepts TrainHeroic API URLs.");
  }
  return url;
}

class Semaphore {
  #active = 0;
  readonly #waiting: Array<(release: () => void) => void> = [];

  constructor(readonly max: number) {}

  acquire(): Promise<() => void> {
    if (this.#active < this.max) {
      this.#active += 1;
      return Promise.resolve(this.#permit());
    }
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  #permit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) next(this.#permit());
      else this.#active -= 1;
    };
  }
}

/**
 * One instance is addressed by verified TrainHeroic user id. Cloudflare serializes access to
 * that global identity, while this explicit queue keeps external fetches capped even though a
 * Durable Object can interleave RPC calls while awaiting I/O.
 *
 * The SQLite namespace is used only for object identity. Credentials, request bodies, session
 * tokens, queue state, and responses remain in memory and are never written to storage.
 */
export class TrainHeroicUpstream extends DurableObject<Env> {
  readonly #semaphore = new Semaphore(MAX_ACCOUNT_CONCURRENCY);

  async dispatch(request: UpstreamRequest): Promise<Response> {
    const release = await this.#semaphore.acquire();
    try {
      const url = trainHeroicUrl(request.url);
      const response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
      });
      if (response.body === null) {
        release();
        return response;
      }

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const pump = response.body.pipeTo(writable).finally(release);
      this.ctx.waitUntil(pump.catch(() => {}));
      return new Response(readable, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      release();
      throw error;
    }
  }
}

function stringBody(body: BodyInit | null | undefined): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  throw new TypeError("The TrainHeroic transport only supports string request bodies.");
}

/** Route one account's SDK traffic through its globally named Durable Object. */
export function createAccountTransport(
  namespace: DurableObjectNamespace<TrainHeroicUpstream>,
  thUserId: number,
): TrainHeroicTransport {
  const upstream = namespace.getByName(String(thUserId));
  return async (url, init) => {
    const body = stringBody(init.body);
    const response = await upstream.dispatch({
      url,
      method: init.method ?? "GET",
      headers: [...new Headers(init.headers).entries()],
      ...(body === undefined ? {} : { body }),
    });
    return response;
  };
}
