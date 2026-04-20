/** Normalizes user-typed numeric string to a plain decimal for parseFloat.
 *  Strips whitespace/nbsp thousands separators, replaces comma with dot.
 *  Returns "" for blank input so callers can distinguish empty from zero. */
export function parseNumericInput(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (s === "") return "";
  return s.replace(/[\s\u00a0]/g, "").replace(",", ".");
}
