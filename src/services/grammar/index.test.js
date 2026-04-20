import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock providerid, et testida aggregator-loogikat isoleeritult.
vi.mock("./providers/languageTool", () => ({ checkWithLanguageTool: vi.fn() }));
vi.mock("./providers/openai", () => ({ checkWithOpenAI: vi.fn() }));

import { checkGrammar } from "./index";
import { checkWithLanguageTool } from "./providers/languageTool";
import { checkWithOpenAI } from "./providers/openai";

describe("checkGrammar — provider-agnostiline aggregator", () => {
  beforeEach(() => {
    checkWithLanguageTool.mockReset();
    checkWithOpenAI.mockReset();
  });

  it("tühi/whitespace/mitte-string → tühjad väljad ilma providerite kutseta", async () => {
    expect(await checkGrammar("")).toEqual({ autoSuggestions: [], reviewSuggestions: [], providerWarnings: [] });
    expect(await checkGrammar("   ")).toEqual({ autoSuggestions: [], reviewSuggestions: [], providerWarnings: [] });
    expect(await checkGrammar(undefined)).toEqual({ autoSuggestions: [], reviewSuggestions: [], providerWarnings: [] });
    expect(checkWithLanguageTool).not.toHaveBeenCalled();
    expect(checkWithOpenAI).not.toHaveBeenCalled();
  });

  it("mõlemad providerid success → autoSuggestions LT-st, reviewSuggestions OpenAI-st, 0 warning'ut", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "success", suggestions: [{ offset: 0, length: 3, message: "LT", replacements: ["a"] }] });
    checkWithOpenAI.mockResolvedValue({ status: "success", suggestions: [{ offset: 5, length: 2, message: "AI", replacements: ["b"] }] });
    const res = await checkGrammar("mingi tekst");
    expect(res.autoSuggestions).toEqual([{ offset: 0, length: 3, message: "LT", replacements: ["a"] }]);
    expect(res.reviewSuggestions).toEqual([{ offset: 5, length: 2, message: "AI", replacements: ["b"] }]);
    expect(res.providerWarnings).toEqual([]);
  });

  it("LT success + OpenAI error → säilita warning, ei viska", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "success", suggestions: [{ offset: 0, length: 1, message: "x", replacements: [] }] });
    checkWithOpenAI.mockResolvedValue({ status: "error", reason: "OPENAI_HTTP_500" });
    const res = await checkGrammar("text");
    expect(res.autoSuggestions).toHaveLength(1);
    expect(res.reviewSuggestions).toEqual([]);
    expect(res.providerWarnings).toEqual([{ provider: "openai", reason: "OPENAI_HTTP_500" }]);
  });

  it("LT error + OpenAI success → säilita warning, ei viska", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "error", reason: "LT_HTTP_502" });
    checkWithOpenAI.mockResolvedValue({ status: "success", suggestions: [{ offset: 0, length: 1, message: "y", replacements: [] }] });
    const res = await checkGrammar("text");
    expect(res.autoSuggestions).toEqual([]);
    expect(res.reviewSuggestions).toHaveLength(1);
    expect(res.providerWarnings).toEqual([{ provider: "languageTool", reason: "LT_HTTP_502" }]);
  });

  it("mõlemad error → viskab errori (UI kuvab 'error' staatuse)", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "error", reason: "LT net" });
    checkWithOpenAI.mockResolvedValue({ status: "error", reason: "AI net" });
    await expect(checkGrammar("text")).rejects.toThrow(/grammar providers failed/);
  });

  it("mõlemad disabled → tühjad tulemused, EI viska (disabled ≠ error)", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "disabled", reason: "LT_ENDPOINT_MISSING" });
    checkWithOpenAI.mockResolvedValue({ status: "disabled", reason: "OPENAI_PROXY_MISSING" });
    const res = await checkGrammar("text");
    expect(res).toEqual({ autoSuggestions: [], reviewSuggestions: [], providerWarnings: [] });
  });

  it("üks disabled + teine error → säilita ainult error-warning, EI viska", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "disabled", reason: "LT_ENDPOINT_MISSING" });
    checkWithOpenAI.mockResolvedValue({ status: "error", reason: "OPENAI_HTTP_429" });
    const res = await checkGrammar("text");
    expect(res.autoSuggestions).toEqual([]);
    expect(res.reviewSuggestions).toEqual([]);
    expect(res.providerWarnings).toEqual([{ provider: "openai", reason: "OPENAI_HTTP_429" }]);
  });

  it("üks disabled + teine success → ainult success'i suggestionid, 0 warning'ut", async () => {
    checkWithLanguageTool.mockResolvedValue({ status: "disabled", reason: "LT_ENDPOINT_MISSING" });
    checkWithOpenAI.mockResolvedValue({ status: "success", suggestions: [{ offset: 1, length: 2, message: "ok", replacements: ["x"] }] });
    const res = await checkGrammar("text");
    expect(res.autoSuggestions).toEqual([]);
    expect(res.reviewSuggestions).toHaveLength(1);
    expect(res.providerWarnings).toEqual([]);
  });

  it("provider viskab ootamatult → käsitle error'ina (safety net)", async () => {
    checkWithLanguageTool.mockRejectedValue(new Error("unexpected"));
    checkWithOpenAI.mockResolvedValue({ status: "success", suggestions: [] });
    const res = await checkGrammar("text");
    expect(res.providerWarnings).toEqual([{ provider: "languageTool", reason: "unexpected" }]);
    expect(res.reviewSuggestions).toEqual([]);
  });

  it("provider tagastab kehva kuju → käsitle error'ina (safety net)", async () => {
    checkWithLanguageTool.mockResolvedValue(null);
    checkWithOpenAI.mockResolvedValue({ status: "success", suggestions: [] });
    const res = await checkGrammar("text");
    expect(res.providerWarnings).toEqual([{ provider: "languageTool", reason: "INVALID_PROVIDER_RESULT" }]);
  });
});
