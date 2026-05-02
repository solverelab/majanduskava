import { describe, it, expect } from 'vitest';
import {
  fetchWithRetry,
  NonRetryableError,
} from '../src/utils/http.js';
import { RealRiigikohusAdapter } from '../src/adapters/RealRiigikohusAdapter.js';

const tick = (ms = 0): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

describe('fetchWithRetry', () => {
  it('retryb 5xx korral ja tagastab lõpuks sisu (spec #1)', async () => {
    let calls = 0;
    const http: typeof fetch = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('srv err', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      }
      return new Response('<html>ok</html>', { status: 200 });
    }) as typeof fetch;

    const out = await fetchWithRetry('https://x/', {
      http,
      retries: 2,
      backoffMs: 1,
      timeoutMs: 200,
    });
    expect(out).toBe('<html>ok</html>');
    expect(calls).toBe(3);
  });

  it('ei retry 4xx korral (spec #2)', async () => {
    let calls = 0;
    const http: typeof fetch = (async () => {
      calls += 1;
      return new Response('nope', {
        status: 404,
        statusText: 'Not Found',
      });
    }) as typeof fetch;

    await expect(
      fetchWithRetry('https://x/', {
        http,
        retries: 3,
        backoffMs: 1,
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(calls).toBe(1);
  });

  it('timeoutib etteantud aja möödudes (spec #3)', async () => {
    let aborted = false;
    const http: typeof fetch = ((_url, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const later = setTimeout(
          () => _resolve(new Response('late', { status: 200 })),
          2000,
        );
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          clearTimeout(later);
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;

    await expect(
      fetchWithRetry('https://x/', {
        http,
        retries: 0,
        backoffMs: 1,
        timeoutMs: 30,
      }),
    ).rejects.toThrow(/fetch failed|aborted/i);
    await tick(0);
    expect(aborted).toBe(true);
  });

  it('annab selge vea kui kõik katsed ebaõnnestuvad', async () => {
    const http: typeof fetch = (async () =>
      new Response('srv', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as typeof fetch;

    await expect(
      fetchWithRetry('https://x/', {
        http,
        retries: 2,
        backoffMs: 1,
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/fetch failed after 3 attempts/);
  });
});

describe('RealRiigikohusAdapter — fetchWithRetry integratsioon (spec #4)', () => {
  it('adapter retryb 5xx vea indekslehel ja õnnestub', async () => {
    const indexHtml = '<html><body><a href="https://x/?asjaNr=2-23-1/1">2-23-1/1</a></body></html>';
    let indexCalls = 0;
    const http: typeof fetch = (async (input: unknown) => {
      const url = String(input);
      if (url === 'https://www.riigikohus.ee/et/lahendid') {
        indexCalls += 1;
        if (indexCalls === 1) {
          return new Response('', {
            status: 500,
            statusText: 'Internal Server Error',
          });
        }
        return new Response(indexHtml, { status: 200 });
      }
      // detail requests: return 404 so adapter skips them with a warn
      return new Response('', { status: 404, statusText: 'Not Found' });
    }) as typeof fetch;

    const adapter = new RealRiigikohusAdapter({
      http,
      retries: 2,
      backoffMs: 1,
      timeoutMs: 200,
      logger: () => {},
    });
    const out = await adapter.fetch(['majanduskava']);
    expect(indexCalls).toBe(2);
    expect(out).toEqual([]);
    expect(adapter.lastRunStats.indexEntries).toBe(1);
    expect(adapter.lastRunStats.canonicalResults).toBe(0);
  });

  it('adapter lööb 4xx indeksi korral kohe, ilma retryta', async () => {
    let indexCalls = 0;
    const http: typeof fetch = (async () => {
      indexCalls += 1;
      return new Response('', { status: 403, statusText: 'Forbidden' });
    }) as typeof fetch;

    const adapter = new RealRiigikohusAdapter({
      http,
      retries: 3,
      backoffMs: 1,
      timeoutMs: 200,
      logger: () => {},
    });
    await expect(adapter.fetch(['x'])).rejects.toThrow(
      /Riigikohus index fetch failed/,
    );
    expect(indexCalls).toBe(1);
  });
});
