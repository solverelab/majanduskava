import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// RF määra koherentsuse regressioonitestid
//
// Invariant: kui invArvutusread näitab kogumisvajadust ja saldoLopp < 0,
// siis maarAastasM2 > 0. Negatiivne lõppseis ja 0-määr ei saa koos olla.
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
  monthEq: 60,
};

describe("RF määr ei jää 0-ks kui kogumisvajadus on olemas", () => {
  it("plannedYear === periodiAasta → maarKuusM2 > 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i1", name: "Katus", plannedYear: 2027, totalCostEUR: 5000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 5000 }],
      }],
    });
    expect(r.invArvutusread.length).toBeGreaterThan(0);
    expect(r.maarAastasM2).toBeGreaterThan(0);
    expect(r.maarKuusM2).toBeGreaterThan(0);
  });

  it("plannedYear < periodiAasta → maarKuusM2 > 0 (perioodi-eelne investeering)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i2", name: "Fassaad", plannedYear: 2025, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 3000 }],
      }],
    });
    expect(r.invArvutusread.length).toBeGreaterThan(0);
    expect(r.investRemondifondist).toBe(3000);
    expect(r.maarAastasM2).toBeGreaterThan(0);
    expect(r.maarKuusM2).toBeGreaterThan(0);
  });

  it("plannedYear > periodiAasta → maarKuusM2 > 0 (kontroll)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i3", name: "Katus", plannedYear: 2030, totalCostEUR: 20000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 20000 }],
      }],
    });
    expect(r.maarAastasM2).toBeGreaterThan(0);
  });
});

describe("negatiivne lõppseis ja 0-määr ei saa koos tekkida", () => {
  it("saldoLopp < 0 → maarAastasM2 > 0 (maarOverride = null)", () => {
    // Suur investeering lühikese ajaga
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      investments: [{
        id: "i4", name: "Suur remont", plannedYear: 2027, totalCostEUR: 100000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 100000 }],
      }],
    });
    expect(r.maarAastasM2).toBeGreaterThan(0);
    // saldoLopp peaks olema >= 0, sest määr katab vajaduse
    expect(r.saldoLopp).toBeGreaterThanOrEqual(0);
  });
});

describe("tingimusliku investeeringu koherentsus loendi, määra ja saldo vahel", () => {
  const mixedInv = [{
    id: "inv1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
    fundingPlan: [
      { source: "Remondifond", amountEUR: 2000 },
      { source: "Laen", amountEUR: 8000 },
    ],
  }];

  it("APPLIED: RF osa kajastub loendis JA mõjutab määra", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPLIED",
      investments: mixedInv,
    });
    // Loendis
    expect(r.invArvutusread.length).toBe(1);
    expect(r.investRemondifondist).toBe(2000);
    // Määras
    expect(r.maarAastasM2).toBeGreaterThan(0);
    // Saldos
    expect(r.saldoLopp).toBeGreaterThanOrEqual(0);
  });

  it("APPROVED: sama koherentsus kehtib", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPROVED",
      investments: mixedInv,
      loans: [{ id: "l1", sepiiriostudInvId: "inv1", principalEUR: 8000, annualRatePct: 4, termMonths: 120 }],
    });
    expect(r.invArvutusread.length).toBe(1);
    expect(r.investRemondifondist).toBe(2000);
    expect(r.maarAastasM2).toBeGreaterThan(0);
    expect(r.saldoLopp).toBeGreaterThanOrEqual(0);
  });

  it("mitu perioodi-eelset investeeringut → määr katab kõik", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        { id: "a", name: "A", plannedYear: 2025, totalCostEUR: 5000, fundingPlan: [{ source: "Remondifond", amountEUR: 3000 }] },
        { id: "b", name: "B", plannedYear: 2026, totalCostEUR: 8000, fundingPlan: [{ source: "Remondifond", amountEUR: 8000 }] },
        { id: "c", name: "C", plannedYear: 2029, totalCostEUR: 4000, fundingPlan: [{ source: "Remondifond", amountEUR: 4000 }] },
      ],
    });
    expect(r.invArvutusread.length).toBe(3);
    expect(r.maarAastasM2).toBeGreaterThan(0);
    // Kogu vajadus peab olema kaetud
    expect(r.saldoLopp).toBeGreaterThanOrEqual(0);
  });
});
