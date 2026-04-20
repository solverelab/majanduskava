// src/services/grammar/providers/languageTool.js
// LanguageTool provider — deterministlikud, reegli-põhised ettepanekud (autoSuggestions).
// Public API: checkWithLanguageTool(text): Promise<ProviderResult>
//   type ProviderResult =
//     | { status: "success",  suggestions: GrammarSuggestion[] }
//     | { status: "disabled", reason: string }
//     | { status: "error",    reason: string }
//
// Endpoint tuleb seadistada EXPLICITLY globalThis.MAJANDUSKAVA_LT_ENDPOINT kaudu.
// Avalikku api.languagetool.org'i ei kasutata enam production-vaikimisi fallback'ina
// — see pole SLA'ga kaetud ja läheb 429'le. Dev'is võib endpointi käsitsi seada
// teadlikuks fallback'iks.

import { fetchWithTimeout } from "../fetchWithTimeout";

const DEFAULT_LANGUAGE = "et-EE";
const TIMEOUT_MS = 10000;

function resolveConfig() {
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  return {
    endpoint: g.MAJANDUSKAVA_LT_ENDPOINT || "",
    language: g.MAJANDUSKAVA_LT_LANGUAGE || DEFAULT_LANGUAGE,
  };
}

function mapMatch(m) {
  return {
    offset: typeof m?.offset === "number" ? m.offset : 0,
    length: typeof m?.length === "number" ? m.length : 0,
    message: String(m?.message ?? m?.shortMessage ?? ""),
    replacements: Array.isArray(m?.replacements)
      ? m.replacements
          .map(r => (typeof r === "string" ? r : String(r?.value ?? "")))
          .filter(v => v !== "")
      : [],
  };
}

export async function checkWithLanguageTool(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { status: "success", suggestions: [] };
  }
  const { endpoint, language } = resolveConfig();
  if (!endpoint) {
    return { status: "disabled", reason: "LT_ENDPOINT_MISSING" };
  }
  const body = new URLSearchParams({ text, language });
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, TIMEOUT_MS);
    if (!res.ok) return { status: "error", reason: `LT_HTTP_${res.status}` };
    const data = await res.json();
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    return { status: "success", suggestions: matches.map(mapMatch) };
  } catch (err) {
    return { status: "error", reason: String(err?.message || err) };
  }
}
