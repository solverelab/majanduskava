import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "./fetchWithTimeout";

describe("fetchWithTimeout", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("hanging fetch → abort + controlled timeout error (UI ei jää lõputult checking olekusse)", async () => {
    globalThis.fetch = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    }));
    await expect(fetchWithTimeout("http://x", {}, 5)).rejects.toThrow(/timeout/);
  });

  it("õnnestub enne timeouti → tagastab vastuse puutumata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await fetchWithTimeout("http://x", {}, 1000);
    expect(res.ok).toBe(true);
  });

  it("mitte-abort viga → pais viga edasi nagu on", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(fetchWithTimeout("http://x", {}, 1000)).rejects.toThrow(/network down/);
  });
});
