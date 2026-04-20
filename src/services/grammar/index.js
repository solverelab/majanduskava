// src/services/grammar/index.js
// Provider-agnostiline grammatikakontroll.
//
// Public interface:
//   checkGrammar(text: string): Promise<GrammarCheckResult>
//
//   type GrammarSuggestion = { offset: number, length: number, message: string, replacements: string[] }
//   type ProviderWarning   = { provider: "languageTool" | "openai", reason: string }
//   type GrammarCheckResult = {
//     autoSuggestions: GrammarSuggestion[],
//     reviewSuggestions: GrammarSuggestion[],
//     providerWarnings: ProviderWarning[],
//   }
//
// Kahe kihi eristus on kihvtiline juba andmetasandil, et UI saaks hiljem neid
// erinevalt kuvada ilma API-d muutmata:
//   autoSuggestions   — deterministlikud/reegli-põhised (LanguageTool)
//   reviewSuggestions — inimese otsust nõudvad (OpenAI / AI providerid)
//
// Providerid tagastavad nüüd kontrollitud kujul {status, suggestions?, reason?}:
//   - "success"  — edukas kutse (võib olla 0 ettepanekut)
//   - "disabled" — provider pole seadistatud (ei ole viga)
//   - "error"    — provider üritas, aga kukkus läbi (timeout, HTTP mitte-ok, parse)
//
// Kui vähemalt üks provider on "error", säilita see providerWarnings'is, et UI
// saaks eristada "0 ettepanekut" vs "0 ettepanekut + kontroll ebaõnnestus".
//
// Canonical tekst JÄÄB puutumata — kõik ettepanekud eeldavad kasutaja
// kinnitust UI poolel (apply ainult siis, kui checkedText === currentText).

import { checkWithLanguageTool } from "./providers/languageTool";
import { checkWithOpenAI } from "./providers/openai";

async function runProvider(fn) {
  try {
    const result = await fn();
    if (!result || typeof result.status !== "string") {
      return { status: "error", reason: "INVALID_PROVIDER_RESULT", suggestions: [] };
    }
    const suggestions = result.status === "success" && Array.isArray(result.suggestions)
      ? result.suggestions
      : [];
    return { status: result.status, reason: result.reason, suggestions };
  } catch (err) {
    return { status: "error", reason: String(err?.message || err), suggestions: [] };
  }
}

export async function checkGrammar(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { autoSuggestions: [], reviewSuggestions: [], providerWarnings: [] };
  }
  const [a, r] = await Promise.all([
    runProvider(() => checkWithLanguageTool(text)),
    runProvider(() => checkWithOpenAI(text)),
  ]);
  const providerWarnings = [];
  if (a.status === "error") providerWarnings.push({ provider: "languageTool", reason: a.reason || "unknown" });
  if (r.status === "error") providerWarnings.push({ provider: "openai", reason: r.reason || "unknown" });
  // Kui MÕLEMAD providerid läksid error'isse (mitte disabled), signaliseeri kutsujale
  // exception'iga, et UI saaks kuvada 'error' staatuse. "disabled" ei ole viga.
  if (a.status === "error" && r.status === "error") {
    throw new Error(`grammar providers failed: ${a.reason}; ${r.reason}`);
  }
  return {
    autoSuggestions: a.status === "success" ? a.suggestions : [],
    reviewSuggestions: r.status === "success" ? r.suggestions : [],
    providerWarnings,
  };
}
