import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// RF arvutuse koherentsuse regressioonitestid
//
// Invariant 1: investRemondifondist + nextPeriodRfVajadus = kogurfSumma
// Invariant 2: katab ≡ saldoLopp >= nextPeriodRfVajadus
// Invariant 3: maarKuusM2 = maarOverride ?? 0  (auto-tuletust pole)
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "0",
  koguPind: 500,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 60,  // periodEndYear = 2031
};

describe("investRemondifondist + nextPeriodRfVajadus = kogurfSumma", () => {
  it("kõik investeeringud perioodi sees", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        { id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 5000, fundingPlan: [{ source: "Remondifond", amountEUR: 5000 }] },
        { id: "i2", name: "Fassaad", plannedYear: 2031, totalCostEUR: 3000, fundingPlan: [{ source: "Remondifond", amountEUR: 3000 }] },
      ],
    });
    const koguRf = r.invDetail.reduce((s, d) => s + d.rfSumma, 0);
    expect(r.investRemondifondist + r.nextPeriodRfVajadus).toBe(koguRf);
    expect(r.investRemondifondist).toBe(8000);
    expect(r.nextPeriodRfVajadus).toBe(0);
  });

  it("investeeringud mõlemas perioodis", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        { id: "i1", name: "A", plannedYear: 2030, totalCostEUR: 10000, fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }] },
        { id: "i2", name: "B", plannedYear: 2032, totalCostEUR: 7000, fundingPlan: [{ source: "Remondifond", amountEUR: 7000 }] },
      ],
    });
    const koguRf = r.invDetail.reduce((s, d) => s + d.rfSumma, 0);
    expect(r.investRemondifondist + r.nextPeriodRfVajadus).toBe(koguRf);
    expect(r.investRemondifondist).toBe(10000);
    expect(r.nextPeriodRfVajadus).toBe(7000);
  });
});

describe("katab invariant kehtib alati", () => {
  it("katab === (saldoLopp >= nextPeriodRfVajadus) eri stsenaariumidel", () => {
    const cases = [
      { saldo: "0", maarOverride: null },
      { saldo: "50000", maarOverride: null },
      { saldo: "0", maarOverride: 1.0 },
      { saldo: "10000", maarOverride: 2.0 },
    ];
    for (const { saldo, maarOverride } of cases) {
      const r = computeRemondifondiArvutus({
        ...BASE,
        saldoAlgusRaw: saldo,
        maarOverride,
        investments: [
          { id: "x", name: "X", plannedYear: 2033, totalCostEUR: 20000, fundingPlan: [{ source: "Remondifond", amountEUR: 20000 }] },
        ],
      });
      expect(r.katab).toBe(r.saldoLopp >= r.nextPeriodRfVajadus);
    }
  });
});

describe("segarahastuse investeering kajastub korrektselt", () => {
  const mixedInv = [{
    id: "inv1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
    fundingPlan: [
      { source: "Remondifond", amountEUR: 2000 },
      { source: "Laen", amountEUR: 8000 },
    ],
  }];

  it("APPLIED: RF osa kajastub invDetail-s ja investRemondifondist-s", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPLIED",
      investments: mixedInv,
    });
    expect(r.invDetail.length).toBe(1);
    expect(r.investRemondifondist).toBe(2000);
  });

  it("APPROVED: sama koherentsus kehtib", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPROVED",
      investments: mixedInv,
      loans: [{ id: "l1", sepiiriostudInvId: "inv1", principalEUR: 8000, annualRatePct: 4, termMonths: 120 }],
    });
    expect(r.invDetail.length).toBe(1);
    expect(r.investRemondifondist).toBe(2000);
  });

  it("mitu investeeringut jagatud perioodide vahel → investRemondifondist ainult praegune", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        { id: "a", name: "A", plannedYear: 2028, totalCostEUR: 5000, fundingPlan: [{ source: "Remondifond", amountEUR: 3000 }] },
        { id: "b", name: "B", plannedYear: 2029, totalCostEUR: 8000, fundingPlan: [{ source: "Remondifond", amountEUR: 8000 }] },
        { id: "c", name: "C", plannedYear: 2033, totalCostEUR: 4000, fundingPlan: [{ source: "Remondifond", amountEUR: 4000 }] },
      ],
    });
    expect(r.invDetail.length).toBe(3);
    expect(r.investRemondifondist).toBe(11000); // A+B (C on järgmises perioodis)
    expect(r.nextPeriodRfVajadus).toBe(4000);
  });
});
