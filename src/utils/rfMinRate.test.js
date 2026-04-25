import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Remondifondi perioodi piir — investRemondifondist vs nextPeriodRfVajadus
//
// Ärireegel:
//   periodEndYear = periodiAasta + floor(monthEq / 12) - 1
//   investRemondifondist = RF investeeringud kuni periodEndYear (kaasa arvatud)
//   nextPeriodRfVajadus  = RF investeeringud pärast periodEndYear
//   katab = saldoLopp >= nextPeriodRfVajadus
//
// maarKuusM2 = maarOverride ?? 0  (auto-tuletust pole)
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  koguPind: 100,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12,  // 1-aastane periood → periodEndYear = 2027
};

function mkInv(name, plannedYear, rfAmount) {
  return {
    id: name, name, plannedYear,
    totalCostEUR: rfAmount,
    fundingPlan: [{ source: "Remondifond", amountEUR: rfAmount }],
  };
}

// S1: periodiAasta investeering
describe("S1: periodiAasta investeering läheb investRemondifondist", () => {
  it("2027 investeering on praeguses perioodis (periodEndYear=2027)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      investments: [mkInv("Katus", 2027, 10000)],
    });
    expect(r.investRemondifondist).toBe(10000);
    expect(r.nextPeriodRfVajadus).toBe(0);
  });
});

// S2: investeering pärast perioodi
describe("S2: investeering pärast perioodi läheb nextPeriodRfVajadus", () => {
  it("2028 investeering 1-aastase perioodiga läheb järgmisse perioodi", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      investments: [mkInv("Katus", 2028, 10000)],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.nextPeriodRfVajadus).toBe(10000);
  });
});

// S3: 5-aastane periood (monthEq=60, periodEndYear=2031)
describe("S3: pikem periood — 2031 investeering on praeguses perioodis", () => {
  it("periodEndYear=2031 sisaldab 2031 investeeringut, mitte 2032", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      monthEq: 60,
      saldoAlgusRaw: "0",
      investments: [
        mkInv("Katus", 2031, 10000),
        mkInv("Fassaad", 2032, 20000),
      ],
    });
    expect(r.investRemondifondist).toBe(10000);
    expect(r.nextPeriodRfVajadus).toBe(20000);
  });
});

// S4: mitu investeeringut mõlemas perioodis
describe("S4: mitu investeeringut jagatud kahe perioodi vahel", () => {
  it("3-aastane periood (periodEndYear=2029) jagab korrektselt", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      monthEq: 36,
      saldoAlgusRaw: "5000",
      investments: [
        mkInv("A", 2028, 8000),   // praegune
        mkInv("B", 2029, 12000),  // praegune (piiri peal)
        mkInv("C", 2030, 15000),  // järgmine
      ],
    });
    expect(r.investRemondifondist).toBe(20000); // A+B
    expect(r.nextPeriodRfVajadus).toBe(15000);  // C
  });
});

// S5: maarKuusM2 = maarOverride ?? 0
describe("S5: maarKuusM2 = maarOverride ?? 0", () => {
  it("override null → maarKuusM2 = 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      maarOverride: null,
      investments: [mkInv("Katus", 2027, 10000)],
    });
    expect(r.maarKuusM2).toBe(0);
    expect(r.maarAastasM2).toBe(0);
  });

  it("override 1.5 → maarKuusM2 = 1.5", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      maarOverride: 1.5,
      investments: [mkInv("Katus", 2027, 10000)],
    });
    expect(r.maarKuusM2).toBe(1.5);
    expect(r.maarAastasM2).toBeCloseTo(18.0, 6);
  });
});

// S6: katab invariant
describe("S6: katab = saldoLopp >= nextPeriodRfVajadus", () => {
  it("piisava saldoga katab=true", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "20000",
      maarOverride: null,
      investments: [mkInv("Katus", 2028, 15000)], // järgmine periood
    });
    // saldoLopp = 20000 + 0 - 0 = 20000 >= 15000
    expect(r.saldoLopp).toBe(20000);
    expect(r.nextPeriodRfVajadus).toBe(15000);
    expect(r.katab).toBe(true);
  });

  it("väikese saldoga katab=false", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "5000",
      maarOverride: null,
      investments: [mkInv("Katus", 2028, 15000)],
    });
    expect(r.saldoLopp).toBe(5000);
    expect(r.katab).toBe(false);
  });

  it("piisava overridega katab=true", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      maarOverride: 2.0,
      investments: [mkInv("Katus", 2028, 2400)], // järgmine periood
    });
    // laekumine = 2.0 * 12 * 100 * 12/12 = 2400; investRemondifondist=0 (2028>2027)
    expect(r.laekuminePerioodis).toBe(2400);
    expect(r.saldoLopp).toBe(2400);
    expect(r.katab).toBe(true);
  });
});

// Äärjuhtumid
describe("äärjuhtumid", () => {
  it("investeeringuid pole → kõik nullid, katab=true", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "5000",
      investments: [],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.nextPeriodRfVajadus).toBe(0);
    expect(r.katab).toBe(true); // 5000 >= 0
  });

  it("ainult laenuga investeering → investRemondifondist=0, nextPeriodRfVajadus=0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      investments: [{
        id: "x", name: "x", plannedYear: 2027, totalCostEUR: 30000,
        fundingPlan: [{ source: "Laen", amountEUR: 30000 }],
      }],
    });
    expect(r.investRemondifondist).toBe(0);
    expect(r.nextPeriodRfVajadus).toBe(0);
  });

  it("koguPind 0 → laekumine 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      koguPind: 0,
      saldoAlgusRaw: "0",
      maarOverride: 1.5,
      investments: [mkInv("Katus", 2027, 10000)],
    });
    expect(r.laekuminePerioodis).toBe(0);
  });
});
