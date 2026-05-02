export class NonRetryableError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'NonRetryableError';
    this.status = status;
  }
}

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  http?: typeof fetch;
  userAgent?: string;
  headers?: Record<string, string>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  opts: FetchWithRetryOptions = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 300;
  const httpFn = opts.http ?? (globalThis.fetch as typeof fetch);
  const userAgent = opts.userAgent ?? 'riigikohus-watch/1.0';

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await httpFn(url, {
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,*/*',
          ...(opts.headers ?? {}),
        },
      });
      if (res.ok) return await res.text();
      if (res.status >= 400 && res.status < 500) {
        throw new NonRetryableError(
          `HTTP ${res.status} ${res.statusText}`.trim(),
          res.status,
        );
      }
      lastErr = new Error(
        `HTTP ${res.status} ${res.statusText}`.trim(),
      );
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastErr = err;
    } finally {
      clearTimeout(tid);
    }
    if (attempt < retries) {
      await sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  const msg =
    lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`fetch failed after ${retries + 1} attempts: ${msg}`);
}
