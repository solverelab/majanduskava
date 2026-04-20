// src/services/grammar/fetchWithTimeout.js
// Ühine fetch-helper AbortController'iga. Katkesta hangunud päring kontrollitud
// timeout-erroriga, et UI ei jääks kunagi lõputult "Kontrollin..." olekusse.

const DEFAULT_TIMEOUT_MS = 10000;

export async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`fetch timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
