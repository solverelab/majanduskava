// src/services/grammar/providers/openai.js
// OpenAI provider — judgment-based review suggestions (reviewSuggestions).
// Kutse läheb MEIE BACKEND/PROXY kaudu — brauserist EI LÄHE API-võti välja.
// Proxy peab aktsepteerima Responses-API-kujulist payloadi ja edastama OpenAI-sse
// serveri poolel, kus API-võtit hoitakse serveri env'is.
//
// Public API: checkWithOpenAI(text): Promise<ProviderResult>
//   type ProviderResult =
//     | { status: "success",  suggestions: GrammarSuggestion[] }
//     | { status: "disabled", reason: string }
//     | { status: "error",    reason: string }
//
// Seadistus:
//   globalThis.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT  (required; muidu 'disabled')
//   globalThis.MAJANDUSKAVA_OPENAI_MODEL           (default: gpt-4.1-mini)
//
// NB: MAJANDUSKAVA_OPENAI_API_KEY EI OLE enam frontendis kasutusel.
// Auth teeb proxy serveri poolel; brauser ei saada Authorization headeri't.

import { fetchWithTimeout } from "../fetchWithTimeout";

const DEFAULT_MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 15000;

function resolveConfig() {
  const g = (typeof globalThis !== "undefined") ? globalThis : {};
  return {
    endpoint: g.MAJANDUSKAVA_OPENAI_PROXY_ENDPOINT || "",
    model: g.MAJANDUSKAVA_OPENAI_MODEL || DEFAULT_MODEL,
  };
}

const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: { type: "integer", minimum: 0 },
          length: { type: "integer", minimum: 0 },
          message: { type: "string" },
          replacements: { type: "array", items: { type: "string" } },
        },
        required: ["offset", "length", "message", "replacements"],
      },
    },
  },
  required: ["suggestions"],
};

const SYSTEM_PROMPT =
  "Sa oled eesti keele stiili- ja grammatika-ülevaataja. Tagasta ainult " +
  "kohapõhised ettepanekud, mis nõuavad inimese otsust (mitte automaatseid " +
  "mehaanilisi parandusi). Iga ettepaneku kohta anna {offset, length, message, " +
  "replacements}; offset on 0-põhine tähemärgi positsioon kasutaja tekstis. " +
  "Ära kirjuta teksti ümber — tagasta ainult täpsed ettepanekud.";

function extractStructured(data) {
  if (typeof data?.output_text === "string") {
    try { return JSON.parse(data.output_text); } catch { /* fallthrough */ }
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const c of contents) {
      if (c?.parsed) return c.parsed;
      if (c?.json) return c.json;
      if (typeof c?.text === "string") {
        try { return JSON.parse(c.text); } catch { /* fallthrough */ }
      }
    }
  }
  return null;
}

function mapSuggestion(s) {
  return {
    offset: typeof s?.offset === "number" ? s.offset : 0,
    length: typeof s?.length === "number" ? s.length : 0,
    message: String(s?.message ?? ""),
    replacements: Array.isArray(s?.replacements) ? s.replacements.map(String) : [],
  };
}

export async function checkWithOpenAI(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { status: "success", suggestions: [] };
  }
  const { endpoint, model } = resolveConfig();
  if (!endpoint) {
    return { status: "disabled", reason: "OPENAI_PROXY_MISSING" };
  }
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "grammar_suggestions",
            schema: SUGGESTION_SCHEMA,
            strict: true,
          },
        },
      }),
    }, TIMEOUT_MS);
    if (!res.ok) return { status: "error", reason: `OPENAI_HTTP_${res.status}` };
    const data = await res.json();
    const parsed = extractStructured(data);
    const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return { status: "success", suggestions: list.map(mapSuggestion) };
  } catch (err) {
    return { status: "error", reason: String(err?.message || err) };
  }
}
