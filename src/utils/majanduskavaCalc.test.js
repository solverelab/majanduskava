import { describe, it, expect } from "vitest";
import {
  arvutaKuumakse, arvutaKuumakseExact,
  computeReserveMin, computeKopiiriondvaade,
} from "./majanduskavaCalc";

// ── arvutaKuumakse ───────────────────────────────────────────────────────────

describe("arvutaKuumakse", () => {
  it("returns 0 when summa=0", () => {
    expect(arvutaKuumakse(0, 5, 120)).toBe(0);
  });

  it("returns 0 when tahtaeg=0", () => {
    expect(arvutaKuumakse(10000, 5, 0)).toBe(0);
  });

  it("zero interest: summa=10000, intress=0, tahtaeg=120 → 83", () => {
    expect(arvutaKuumakse(10000, 0, 120)).toBe(Math.round(10000 / 120));
    expect(arvutaKuumakse(10000, 0, 120)).toBe(83);
  });

  it("standard annuity: summa=100000, intress=3.6, tahtaeg=240 → 585", () => {
    const result = arvutaKuumakse(100000, 3.6, 240);
    // r=0.003, n=240, PMT = 100000*0.003*1.003^240/(1.003^240-1) ≈ 584.98
    expect(result).toBe(585);
  });

  it("comma decimal input: intress='3,6' → same as 3.6", () => {
    expect(arvutaKuumakse(100000, "3,6", 240)).toBe(arvutaKuumakse(100000, 3.6, 240));
  });
});

describe("arvutaKuumakseExact", () => {
  it("returns unrounded value", () => {
    const exact = arvutaKuumakseExact(100000, 3.6, 240);
    const rounded = arvutaKuumakse(100000, 3.6, 240);
    expect(Math.round(exact)).toBe(rounded);
    expect(exact).not.toBe(rounded); // not already an integer
  });
});

// ── computeReserveMin ────────────────────────────────────────────────────────

describe("computeReserveMin", () => {
  it("empty costRows, monthEq=12 → zero", () => {
    const r = computeReserveMin([], 12);
    expect(r).toEqual({ noutavMiinimum: 0, aastaKulud: 0 });
  });

  it("one row summaInput=1200, monthEq=12", () => {
    const r = computeReserveMin([{ summaInput: "1200" }], 12);
    expect(r).toEqual({ noutavMiinimum: 100, aastaKulud: 1200 });
  });

  it("one row summaInput=600, monthEq=6", () => {
    const r = computeReserveMin([{ summaInput: "600" }], 6);
    expect(r).toEqual({ noutavMiinimum: 100, aastaKulud: 1200 });
  });

  it("aastaKulud === noutavMiinimum * 12 always", () => {
    const cases = [
      [[], 12],
      [[{ summaInput: "999" }], 7],
      [[{ summaInput: "1500" }, { summaInput: "300" }], 9],
    ];
    for (const [rows, mEq] of cases) {
      const r = computeReserveMin(rows, mEq);
      expect(r.aastaKulud).toBe(r.noutavMiinimum * 12);
    }
  });
});

// ── computeKopiiriondvaade ───────────────────────────────────────────────────

describe("computeKopiiriondvaade", () => {
  it("basic 12-month plan, no loans", () => {
    const costRows = [
      { category: "Soojus", summaInput: "1200" },
      { category: "Haldus", summaInput: "600", arvutus: "perioodis" },
    ];
    const incomeRows = [{ summaInput: "200" }];
    const r = computeKopiiriondvaade(costRows, incomeRows, [], 12);

    expect(r.kommunaalKokku).toBe(100);  // 1200/12
    expect(r.haldusKokku).toBe(50);      // 600/12 (perioodis, mEq=12)
    expect(r.kuludKokku).toBe(150);
    expect(r.muudTuludKokku).toBe(200);  // default: per month
  });

  it("arvutus 'aastas' vs 'perioodis' same when monthEq=12", () => {
    const rowA = [{ category: "Haldus", summaInput: "1200", arvutus: "aastas" }];
    const rowB = [{ category: "Haldus", summaInput: "1200", arvutus: "perioodis" }];
    const rA = computeKopiiriondvaade(rowA, [], [], 12);
    const rB = computeKopiiriondvaade(rowB, [], [], 12);
    expect(rA.haldusKokku).toBe(100);
    expect(rB.haldusKokku).toBe(100);
  });

  it("arvutus 'aastas' vs 'perioodis' DIFFERS when monthEq=6", () => {
    const rowA = [{ category: "Haldus", summaInput: "1200", arvutus: "aastas" }];
    const rowB = [{ category: "Haldus", summaInput: "1200", arvutus: "perioodis" }];
    const rA = computeKopiiriondvaade(rowA, [], [], 6);
    const rB = computeKopiiriondvaade(rowB, [], [], 6);
    expect(rA.haldusKokku).toBe(100);  // 1200/12
    expect(rB.haldusKokku).toBe(200);  // 1200/6
    expect(rA.haldusKokku).not.toBe(rB.haldusKokku);
  });

  it("vaheKommunaalJaMuuTulu === muudTuludKokku - kommunaalKokku", () => {
    const costRows = [
      { category: "Soojus", summaInput: "3600" },
      { category: "Haldus", summaInput: "1200", arvutus: "aastas" },
    ];
    const incomeRows = [{ summaInput: "500" }];
    const r = computeKopiiriondvaade(costRows, incomeRows, [], 12);
    expect(r.vaheKommunaalJaMuuTulu).toBe(r.muudTuludKokku - r.kommunaalKokku);
  });

  it("equal apartments get equal shares", () => {
    // This tests the principle that kommunaalKokku and haldusKokku are per-month totals
    // that can be divided proportionally by area
    const costRows = [
      { category: "Soojus", summaInput: "2400" },  // 200/kuu
      { category: "Haldus", summaInput: "1200", arvutus: "aastas" },  // 100/kuu
    ];
    const r = computeKopiiriondvaade(costRows, [], [], 12);
    // Two equal 50m² apartments would each get 50% share
    const aptShare = 0.5;
    expect(Math.round(r.kommunaalKokku * aptShare)).toBe(100);
    expect(Math.round(r.haldusKokku * aptShare)).toBe(50);
  });
});
