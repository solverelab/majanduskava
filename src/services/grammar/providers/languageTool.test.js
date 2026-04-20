import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkWithLanguageTool } from "./languageTool";

describe("LanguageTool provider", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.MAJANDUSKAVA_LT_ENDPOINT;
    delete globalThis.MAJANDUSKAVA_LT_LANGUAGE;
  });

  it("tühi/whitespace/mitte-string → success[] ilma fetch'ita", async () => {
    const f = vi.fn();
    globalThis.fetch = f;
    expect(await checkWithLanguageTool("")).toEqual({ status: "success", suggestions: [] });
    expect(await checkWithLanguageTool("   ")).toEqual({ status: "success", suggestions: [] });
    expect(await checkWithLanguageTool(undefined)).toEqual({ status: "success", suggestions: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it("endpoint puudub → disabled (ei tee fetch'i avalikule api.languagetool.org'ile)", async () => {
    const f = vi.fn();
    globalThis.fetch = f;
    const res = await checkWithLanguageTool("Tere");
    expect(res.status).toBe("disabled");
    expect(res.reason).toBe("LT_ENDPOINT_MISSING");
    expect(f).not.toHaveBeenCalled();
  });

  it("edukas vastus → matches mappitakse GrammarSuggestion[]", async () => {
    globalThis.MAJANDUSKAVA_LT_ENDPOINT = "https://lt.example.com/v2/check";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: [
          { offset: 0, length: 5, message: "Õigekiri", replacements: [{ value: "tere" }] },
        ],
      }),
    });
    const res = await checkWithLanguageTool("tehte");
    expect(res).toEqual({
      status: "success",
      suggestions: [{ offset: 0, length: 5, message: "Õigekiri", replacements: ["tere"] }],
    });
  });

  it("non-ok HTTP → kontrollitud error (ei viska)", async () => {
    globalThis.MAJANDUSKAVA_LT_ENDPOINT = "https://lt.example.com/v2/check";
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    const res = await checkWithLanguageTool("text");
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/502/);
  });

  it("võrguviga → kontrollitud error", async () => {
    globalThis.MAJANDUSKAVA_LT_ENDPOINT = "https://lt.example.com/v2/check";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const res = await checkWithLanguageTool("text");
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/connection refused/);
  });

  it("timeout → kontrollitud error (UI ei jää checking olekusse)", async () => {
    globalThis.MAJANDUSKAVA_LT_ENDPOINT = "https://lt.example.com/v2/check";
    // Ei peagi tegelikku timeouti simuleerima — piisab AbortError'ist nagu
    // fetchWithTimeout selle üles visib. Kontrolli fetch'i kutse kohale jõudes
    // simuleerime AbortError'it otse.
    const abortErr = new Error("fetch timeout after 10000ms");
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);
    const res = await checkWithLanguageTool("text");
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/timeout/);
  });

  it("konfigureeritav endpoint + keel", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) });
    globalThis.fetch = f;
    globalThis.MAJANDUSKAVA_LT_ENDPOINT = "https://lt.example.com/v2/check";
    globalThis.MAJANDUSKAVA_LT_LANGUAGE = "et";
    await checkWithLanguageTool("Tere");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://lt.example.com/v2/check");
    expect(init.body).toContain("language=et");
    expect(init.signal).toBeDefined();
  });
});
