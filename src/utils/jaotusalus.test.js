import { describe, it, expect } from "vitest";
import { kulureaOsa, jaotusalusSilt, computeRemondifondiArvutus, KOMMUNAALTEENUSED, HALDUSTEENUSED } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// jaotusalus — kulurea jaotusaluse testid
// ══════════════════════════════════════════════════════════════════════

describe("jaotusalusSilt helper", () => {
  it('"m2" => "m² järgi"', () => {
    expect(jaotusalusSilt("m2")).toBe("m² järgi");
  });

  it('"korter" => "korterite vahel võrdselt"', () => {
    expect(jaotusalusSilt("korter")).toBe("korterite vahel võrdselt");
  });

  it('puuduv (undefined) => "m² järgi"', () => {
    expect(jaotusalusSilt(undefined)).toBe("m² järgi");
  });

  it('null => "m² järgi"', () => {
    expect(jaotusalusSilt(null)).toBe("m² järgi");
  });
});

describe("kulureaOsa helper", () => {
  it('"m2" → pind / koguPind', () => {
    expect(kulureaOsa("m2", 50, 200, 4)).toBeCloseTo(0.25, 10);
  });

  it('"korter" → 1 / aptCount', () => {
    expect(kulureaOsa("korter", 50, 200, 4)).toBeCloseTo(0.25, 10);
    expect(kulureaOsa("korter", 100, 200, 4)).toBeCloseTo(0.25, 10); // pind ei mõjuta
    expect(kulureaOsa("korter", 20, 200, 5)).toBeCloseTo(0.20, 10);
  });

  it("puuduv jaotusalus (undefined/null) → käitub nagu m2", () => {
    expect(kulureaOsa(undefined, 50, 200, 4)).toBeCloseTo(0.25, 10);
    expect(kulureaOsa(null, 50, 200, 4)).toBeCloseTo(0.25, 10);
  });

  it("koguPind === 0 → m2 annab 0", () => {
    expect(kulureaOsa("m2", 50, 0, 4)).toBe(0);
  });

  it("aptCount === 0 → korter annab 0", () => {
    expect(kulureaOsa("korter", 50, 200, 0)).toBe(0);
  });

  it('"korter" erinev pindadega korteritega — võrdne jaotus', () => {
    const osa1 = kulureaOsa("korter", 30, 200, 3);
    const osa2 = kulureaOsa("korter", 80, 200, 3);
    const osa3 = kulureaOsa("korter", 90, 200, 3);
    expect(osa1).toBeCloseTo(1 / 3, 10);
    expect(osa2).toBeCloseTo(1 / 3, 10);
    expect(osa3).toBeCloseTo(1 / 3, 10);
  });

  it('"m2" erinev pindadega korteritega — pindala-põhine jaotus', () => {
    const osa1 = kulureaOsa("m2", 30, 200, 3);
    const osa2 = kulureaOsa("m2", 80, 200, 3);
    expect(osa1).toBeCloseTo(0.15, 10);
    expect(osa2).toBeCloseTo(0.40, 10);
  });
});

describe("tagasiühilduvus — puuduv jaotusalus", () => {
  it('vana rida ilma jaotusaluseta käitub nagu "m2"', () => {
    // Simuleerime vana importi — jaotusalus puudub
    const vanaRida = { id: "x", side: "COST", category: "Prügivedu", summaInput: 120 };
    const osa = kulureaOsa(vanaRida.jaotusalus, 50, 200, 4);
    expect(osa).toBeCloseTo(0.25, 10); // m2-põhine
  });
});

describe("computeRemondifondiArvutus ei muutu jaotusaluse tõttu", () => {
  it("RF arvutus ignoreerib jaotusalust", () => {
    const BASE = {
      saldoAlgusRaw: "0", koguPind: 200, periodiAasta: 2027,
      pangaKoef: 1.15, kogumisViis: "eraldi",
      pangaMaarOverride: null, maarOverride: null,
      loans: [], loanStatus: "APPLIED", monthEq: 60,
      investments: [{
        id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    };
    const r = computeRemondifondiArvutus(BASE);
    // RF arvutus ei sõltu kuluridadest ega jaotusalusest
    expect(r.maarKuusM2).toBeGreaterThan(0);
    expect(r.investRemondifondist).toBe(10000);
  });
});

describe("serialize/import roundtrip", () => {
  it("puuduv jaotusalus fallback pärast JSON parse'i", () => {
    const json = '{"id":"x","side":"COST","category":"Haldus"}';
    const parsed = JSON.parse(json);
    // jaotusalus puudub — kulureaOsa fallback
    expect(kulureaOsa(parsed.jaotusalus, 50, 200, 4)).toBeCloseTo(0.25, 10);
  });
});

describe("korteriteKuumaksed filtreerimine — ainult KOMMUNAAL ja HALDUS", () => {
  // Simuleerime korteriteKuumaksed loop'i loogikat
  function simuleeriJaotus(costRows, pind, koguPind, aptCount, mEq) {
    const kulureadKuus = costRows.map(r => {
      const v = Math.max(0, parseFloat(r.summaInput) || 0);
      const kuus = KOMMUNAALTEENUSED.includes(r.category)
        ? v / mEq
        : r.arvutus === "aastas" ? v / 12
        : r.arvutus === "perioodis" ? v / mEq
        : v;
      return { category: r.category, kuus, jaotusalus: r.jaotusalus || "m2" };
    });

    let kommunaal = 0;
    let haldus = 0;
    for (const kr of kulureadKuus) {
      const osa = kulureaOsa(kr.jaotusalus, pind, koguPind, aptCount);
      if (KOMMUNAALTEENUSED.includes(kr.category)) kommunaal += kr.kuus * osa;
      else if (HALDUSTEENUSED.includes(kr.category)) haldus += kr.kuus * osa;
    }
    return { kommunaal: Math.round(kommunaal), haldus: Math.round(haldus) };
  }

  it("LAENUMAKSED read ei mõjuta kommunaal ega haldus summat", () => {
    const rows = [
      { category: "Haldus", summaInput: "1200", arvutus: "aastas", jaotusalus: "m2" },
      { category: "Laenumakse", summaInput: "5000", arvutus: "aastas", jaotusalus: "m2" },
    ];
    const r = simuleeriJaotus(rows, 50, 200, 4, 12);
    expect(r.kommunaal).toBe(0);
    expect(r.haldus).toBe(25); // 1200/12 * 50/200 = 25
    // Laenumakse rida ei mõjuta kumbagi
  });

  it("tühja kategooriaga rida ei mõjuta summasid", () => {
    const rows = [
      { category: "", summaInput: "600", arvutus: "aastas", jaotusalus: "m2" },
      { category: "Soojus", summaInput: "2400", jaotusalus: "m2" },
    ];
    const r = simuleeriJaotus(rows, 50, 200, 4, 12);
    expect(r.kommunaal).toBe(50); // 2400/12 * 50/200 = 50
    expect(r.haldus).toBe(0);
    // Tühja kategooriaga rida ignoreeritakse
  });

  it("segaread — m2 ja korter jaotusalus koos", () => {
    const rows = [
      { category: "Haldus", summaInput: "1200", arvutus: "aastas", jaotusalus: "m2" },
      { category: "Prügivedu", summaInput: "480", arvutus: "aastas", jaotusalus: "korter" },
    ];
    // Korter 50m² / 200m² koguPind, 4 korterit
    const r = simuleeriJaotus(rows, 50, 200, 4, 12);
    // Haldus: 1200/12 * 50/200 = 25
    expect(r.haldus).toBe(25 + 10); // Haldus 25 + Prügivedu 480/12 * 1/4 = 10
    expect(r.kommunaal).toBe(0);
  });
});
