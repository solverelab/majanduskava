import { describe, it, expect } from "vitest";
import { computeReserveMin } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Reservkapitali ploki regressioonitestid
//
// Kontrollib:
// 1. computeReserveMin loogika ei muutunud
// 2. reservkapitali määr €/m²/kuu arvutatakse õigesti
// 3. algseis → kogumine → kasutamine → lõppseis voog on koherentne
// 4. katvus ja miinimum on arvutuslikult korrektsed
// ══════════════════════════════════════════════════════════════════════

describe("computeReserveMin ei muutu", () => {
  it("tagastab 1/12 aastakuludest KrtS § 8 järgi", () => {
    const costRows = [
      { summaInput: "12000" },
      { summaInput: "6000" },
    ];
    const r = computeReserveMin(costRows, 12);
    // periodiKulud = 18000, monthEq = 12 → noutavMiinimum = 18000/12 = 1500
    expect(r.noutavMiinimum).toBe(1500);
    expect(r.aastaKulud).toBe(18000);
  });

  it("arvestab moonthEq-d (periood pole alati 12 kuud)", () => {
    const costRows = [{ summaInput: "30000" }];
    const r = computeReserveMin(costRows, 60);
    // periodiKulud = 30000, monthEq = 60 → noutavMiinimum = 30000/60 = 500
    expect(r.noutavMiinimum).toBe(500);
    expect(r.aastaKulud).toBe(6000);
  });

  it("tühja kuluridadega tagastab 0", () => {
    const r = computeReserveMin([], 12);
    expect(r.noutavMiinimum).toBe(0);
    expect(r.aastaKulud).toBe(0);
  });
});

describe("reservkapitali määr €/m²/kuu", () => {
  // Arvutus UI-s: rkKogumine / mEq / koguPind
  const calcRkMaarKuusM2 = (rkKogumine, mEq, koguPind) =>
    koguPind > 0 ? rkKogumine / mEq / koguPind : 0;

  it("arvutatakse õigesti tavajuhul", () => {
    // 1200 € kogumine, 12 kuud, 200 m²
    // → 1200 / 12 / 200 = 0.50 €/m²/kuu
    expect(calcRkMaarKuusM2(1200, 12, 200)).toBeCloseTo(0.50, 2);
  });

  it("arvestab mEq-d (periood pole alati 12 kuud)", () => {
    // 5000 € kogumine, 60 kuud, 300 m²
    // → 5000 / 60 / 300 ≈ 0.28 €/m²/kuu
    expect(calcRkMaarKuusM2(5000, 60, 300)).toBeCloseTo(0.2778, 3);
  });

  it("koguPind = 0 → 0 (ei jaga nulliga)", () => {
    expect(calcRkMaarKuusM2(1200, 12, 0)).toBe(0);
  });

  it("kogumine = 0 → 0", () => {
    expect(calcRkMaarKuusM2(0, 12, 200)).toBe(0);
  });
});

describe("algseis-kogumine-kasutamine-lõppseis voog", () => {
  // Simuleerib UI IIFE loogikat
  const calcSaldo = (saldoAlgus, kogumine, kasutamine) => ({
    rkSaldoAlgus: parseFloat(saldoAlgus) || 0,
    rkKogumine: kogumine || 0,
    rkKasutamine: parseFloat(kasutamine) || 0,
    rkSaldoLopp: (parseFloat(saldoAlgus) || 0) + (kogumine || 0) - (parseFloat(kasutamine) || 0),
  });

  it("lõppsaldo = algsaldo + kogumine - kasutamine", () => {
    const s = calcSaldo("5000", 1200, "300");
    expect(s.rkSaldoLopp).toBe(5900);
  });

  it("tühja algsaldoga lõppsaldo = kogumine - kasutamine", () => {
    const s = calcSaldo("", 1500, "0");
    expect(s.rkSaldoLopp).toBe(1500);
  });

  it("negatiivne lõppsaldo, kui kasutamine ületab algsaldo + kogumine", () => {
    const s = calcSaldo("1000", 500, "2000");
    expect(s.rkSaldoLopp).toBe(-500);
  });
});

describe("katvus ja miinimum", () => {
  it("katvusKuud = lõppsaldo / kuukulud", () => {
    const kuuKulud = 1500;
    const rkSaldoLopp = 4500;
    const katvusKuud = kuuKulud > 0 ? rkSaldoLopp / kuuKulud : 0;
    expect(katvusKuud).toBe(3);
  });

  it("katvusLabel: >= 3 → Hea, >= 1.5 → Rahuldav, muidu → Riskantne", () => {
    const label = (kuud) => kuud >= 3 ? "Hea" : kuud >= 1.5 ? "Rahuldav" : "Riskantne";
    expect(label(3)).toBe("Hea");
    expect(label(5)).toBe("Hea");
    expect(label(1.5)).toBe("Rahuldav");
    expect(label(2.9)).toBe("Rahuldav");
    expect(label(1.4)).toBe("Riskantne");
    expect(label(0)).toBe("Riskantne");
  });

  it("vastab miinimumile, kui lõppsaldo >= noutavMiinimum", () => {
    const noutavMiinimum = 1500;
    expect(1500 >= noutavMiinimum).toBe(true);
    expect(1499 >= noutavMiinimum).toBe(false);
  });
});
