import { describe, it, expect } from "vitest";
import { parseNumericInput } from "./parseNumericInput";

// ══════════════════════════════════════════════════════════════════════
// A. parseNumericInput unit tests
// ══════════════════════════════════════════════════════════════════════

describe("parseNumericInput", () => {
  it("1234,56 → 1234.56", () => expect(parseNumericInput("1234,56")).toBe("1234.56"));
  it("1234.56 → 1234.56", () => expect(parseNumericInput("1234.56")).toBe("1234.56"));
  it("1 234,56 → 1234.56", () => expect(parseNumericInput("1 234,56")).toBe("1234.56"));
  it("1 234.56 → 1234.56", () => expect(parseNumericInput("1 234.56")).toBe("1234.56"));
  it("1\u00a0234,56 → 1234.56 (nbsp)", () => expect(parseNumericInput("1\u00a0234,56")).toBe("1234.56"));
  it("45 000 → 45000", () => expect(parseNumericInput("45 000")).toBe("45000"));
  it('"" → ""', () => expect(parseNumericInput("")).toBe(""));
  it('"  " → ""', () => expect(parseNumericInput("  ")).toBe(""));
  it("null → ''", () => expect(parseNumericInput(null)).toBe(""));
  it("undefined → ''", () => expect(parseNumericInput(undefined)).toBe(""));
  it("abc → NaN for parseFloat", () => expect(parseFloat(parseNumericInput("abc"))).toBeNaN());
  it("-1234,56 → -1234.56", () => expect(parseNumericInput("-1234,56")).toBe("-1234.56"));
  it("0 → 0", () => expect(parseNumericInput("0")).toBe("0"));
  it("1234.56 (number) → 1234.56", () => expect(parseNumericInput(1234.56)).toBe("1234.56"));
});

// ══════════════════════════════════════════════════════════════════════
// B. blur-käitumine: NumberInput / EuroInput
// ══════════════════════════════════════════════════════════════════════

// Mirrors NumberInput onBlur logic exactly
function simulateNumberBlur(display, prevValue) {
  const cleaned = parseNumericInput(display);
  if (cleaned !== "") {
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) return { state: parsed, changed: true };
  }
  return { state: prevValue, changed: false };
}

// Mirrors EuroInput onBlur logic exactly
function simulateEuroBlur(display, prevValue) {
  const cleaned = parseNumericInput(display);
  if (cleaned !== "") {
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) return { state: Math.round(parsed), changed: true };
  }
  return { state: prevValue, changed: false };
}

describe("NumberInput blur", () => {
  it("kehtiv sisend uuendab state'i", () => {
    const r = simulateNumberBlur("52,3", 0);
    expect(r).toEqual({ state: 52.3, changed: true });
  });

  it("tühi sisend EI muuda state'i", () => {
    const r = simulateNumberBlur("", 52.3);
    expect(r).toEqual({ state: 52.3, changed: false });
  });

  it("vigane sisend EI muuda state'i", () => {
    const r = simulateNumberBlur("abc", 52.3);
    expect(r).toEqual({ state: 52.3, changed: false });
  });

  it("tühi sisend EI muutu 0-ks", () => {
    const r = simulateNumberBlur("", 3.6);
    expect(r.state).not.toBe(0);
    expect(r.state).toBe(3.6);
  });

  it("vigane sisend EI muutu 0-ks", () => {
    const r = simulateNumberBlur("xyz", 3.6);
    expect(r.state).not.toBe(0);
    expect(r.state).toBe(3.6);
  });

  it("punkt kümnenderaldajana", () => {
    expect(simulateNumberBlur("1.15", 0).state).toBe(1.15);
  });

  it("vigane blur kui eelmine on 0 → state jääb 0-ks (tahtlik: 0 = pole sisestatud)", () => {
    const r = simulateNumberBlur("abc", 0);
    expect(r).toEqual({ state: 0, changed: false });
  });

  it("null → säilita eelmine", () => {
    const r = simulateNumberBlur(null, 5);
    expect(r).toEqual({ state: 5, changed: false });
  });
});

describe("EuroInput blur", () => {
  it("kehtiv sisend uuendab state'i", () => {
    const r = simulateEuroBlur("1 234,56", 0);
    expect(r).toEqual({ state: 1235, changed: true });
  });

  it("tühi sisend EI muuda state'i", () => {
    const r = simulateEuroBlur("", 30000);
    expect(r).toEqual({ state: 30000, changed: false });
  });

  it("vigane sisend EI muuda state'i", () => {
    const r = simulateEuroBlur("abc", 30000);
    expect(r).toEqual({ state: 30000, changed: false });
  });

  it("tühi sisend EI muutu 0-ks", () => {
    const r = simulateEuroBlur("", 45000);
    expect(r.state).not.toBe(0);
    expect(r.state).toBe(45000);
  });

  it("vigane sisend EI muutu 0-ks", () => {
    const r = simulateEuroBlur("---", 45000);
    expect(r.state).not.toBe(0);
    expect(r.state).toBe(45000);
  });

  it("tühik + nbsp tuhandeteeraldaja", () => {
    expect(simulateEuroBlur("45 000", 0).state).toBe(45000);
    expect(simulateEuroBlur("45\u00a0000", 0).state).toBe(45000);
  });

  it("0 on kehtiv väärtus", () => {
    const r = simulateEuroBlur("0", 10000);
    expect(r).toEqual({ state: 0, changed: true });
  });
});

// ══════════════════════════════════════════════════════════════════════
// C. regressioon: purunemiskohad
// ══════════════════════════════════════════════════════════════════════

describe("regression: areaM2 flow", () => {
  it("areaM2 jääb numbriks pärast blur'i — toFixed ei murdu", () => {
    // Simulate: kasutaja tühjendab areaM2 ja blur'ib
    const prevAreaM2 = 52.3;
    const r = simulateNumberBlur("", prevAreaM2);
    // State ei muutunud → areaM2 on endiselt number
    expect(typeof r.state).toBe("number");
    expect(() => r.state.toFixed(2)).not.toThrow();
    expect(r.state.toFixed(2)).toBe("52.30");
  });

  it("vigane areaM2 sisend ei muuda state'i stringiks", () => {
    const r = simulateNumberBlur("abc", 48.7);
    expect(typeof r.state).toBe("number");
    expect(() => r.state.toFixed(2)).not.toThrow();
  });
});

describe("regression: plannedEUR flow", () => {
  it("plannedEUR jääb numbriks pärast blur'i — jagamine ei anna NaN", () => {
    // Simulate: kasutaja tühjendab reserve.plannedEUR ja blur'ib
    const prevPlannedEUR = 3000;
    const r = simulateEuroBlur("", prevPlannedEUR);
    expect(typeof r.state).toBe("number");
    expect(Number.isNaN(r.state / 12)).toBe(false);
    expect(r.state / 12).toBe(250);
  });

  it("vigane plannedEUR sisend ei anna NaN jagamisel", () => {
    const r = simulateEuroBlur("abc", 3000);
    expect(typeof r.state).toBe("number");
    expect(Number.isNaN(r.state / 12)).toBe(false);
  });
});
