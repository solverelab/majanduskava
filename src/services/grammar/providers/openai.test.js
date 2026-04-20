import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkWithOpenAI } from "./openai";

describe("OpenAI provider (proxy + structured output)", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.MAJANDUSKAVA_OPENAI_API_KEY;
    delete globalThis.MAJANDUSKAVA_OPENAI_MODEL;
    delete globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT;
  });

  it("proxy endpoint puudub → disabled (mitte success [])", async () => {
    const f = vi.fn();
    globalThis.fetch = f;
    const res = await checkWithOpenAI("mingisugune tekst");
    expect(res.status).toBe("disabled");
    expect(res.reason).toBe("OPENAI_PROXY_MISSING");
    expect(f).not.toHaveBeenCalled();
  });

  it("tühi/whitespace → success[] ilma fetch'ita", async () => {
    const f = vi.fn();
    globalThis.fetch = f;
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    expect(await checkWithOpenAI("")).toEqual({ status: "success", suggestions: [] });
    expect(await checkWithOpenAI("   ")).toEqual({ status: "success", suggestions: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it("frontend EI loe MAJANDUSKAVA_OPENAI_API_KEY ega saada Authorization headeri't", async () => {
    globalThis.MAJANDUSKAVA_OPENAI_API_KEY = "sk-should-not-leak";
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ output_text: '{"suggestions":[]}' }) });
    globalThis.fetch = f;
    await checkWithOpenAI("Tere");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://proxy.example.com/grammar");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers["Authorization"]).toBeUndefined();
    // body ei tohi API-võtit sisaldada
    expect(init.body).not.toContain("sk-should-not-leak");
  });

  it("edukas structured output (output_text kujul) → suggestions[]", async () => {
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          suggestions: [
            { offset: 3, length: 4, message: "Sõnastus", replacements: ["variant A", "variant B"] },
          ],
        }),
      }),
    });
    const res = await checkWithOpenAI("See on pikk lause.");
    expect(res).toEqual({
      status: "success",
      suggestions: [
        { offset: 3, length: 4, message: "Sõnastus", replacements: ["variant A", "variant B"] },
      ],
    });
  });

  it("non-ok HTTP → kontrollitud error (ei viska)", async () => {
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const res = await checkWithOpenAI("text");
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/401/);
  });

  it("timeout → kontrollitud error", async () => {
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch timeout after 15000ms"));
    const res = await checkWithOpenAI("text");
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/timeout/);
  });

  it("saadab Responses-API-kujulise payload'i (JSON-skeemiga) proxy URL-ile, ilma Authorization'ita", async () => {
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ output_text: '{"suggestions":[]}' }) });
    globalThis.fetch = f;
    await checkWithOpenAI("Tere");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://proxy.example.com/grammar");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Authorization"]).toBeUndefined();
    expect(init.signal).toBeDefined();
    const body = JSON.parse(init.body);
    expect(body.model).toBeDefined();
    expect(body.text?.format?.type).toBe("json_schema");
    expect(body.text?.format?.name).toBe("grammar_suggestions");
    expect(body.text?.format?.strict).toBe(true);
    expect(body.text?.format?.schema?.required).toContain("suggestions");
  });

  it("defensiivne parse: sobimatu JSON output_text → success[]", async () => {
    globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT = "https://proxy.example.com/grammar";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "not json" }),
    });
    const res = await checkWithOpenAI("text");
    expect(res).toEqual({ status: "success", suggestions: [] });
  });
});
