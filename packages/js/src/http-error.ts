/**
 * A final non-2xx response from TrainHeroic. The error deliberately carries only request
 * metadata that is safe to send to telemetry: never the path, query string, request body,
 * response body, credentials, or session token.
 */
export class TrainHeroicHttpError extends Error {
  override readonly name = "TrainHeroicHttpError";
  readonly method: string;
  readonly status: number;
  readonly host: string;

  constructor(method: string, url: string, status: number) {
    const parsed = new URL(url);
    const normalizedMethod = method.toUpperCase();
    super(`TrainHeroic ${normalizedMethod} request failed with HTTP ${status}`);
    this.method = normalizedMethod;
    this.status = status;
    this.host = parsed.host;
  }
}

export type TrainHeroicHttpErrorHandler = (error: TrainHeroicHttpError) => void | PromiseLike<void>;

/** Call observability hooks without allowing them to change SDK behavior. */
export function notifyHttpError(
  handler: TrainHeroicHttpErrorHandler | undefined,
  method: string,
  url: string,
  status: number,
): void {
  if (!handler) return;
  try {
    void Promise.resolve(handler(new TrainHeroicHttpError(method, url, status))).catch(() => {});
  } catch {
    // Telemetry must never change the API result or hide the upstream response.
  }
}
