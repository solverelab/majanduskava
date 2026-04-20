import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Remondifondi minimaalne püsiv kogumismäär — aastapõhine ajajoon
//
// Ärireegel:
//   saldo(y) = eelmine_saldo − rfOutflow(y) + rate × koguPind
//   nõue: saldo(y) >= 0 igal aastal
//   tulemus: minimaalne rate (€/m²/a), ülespoole 0.01-ni
//
// Variant A: sama aasta kogumine TOHIB katta sama aasta investeeringut
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
  monthEq: 12,
};

function rfRate(saldoAlgus, investments) {
  const r = computeRemondifondiArvutus({
    ...BASE,
    saldoAlgusRaw: String(saldoAlgus),
    investments,
  });
  return r.maarAastasM2; // €/m²/a
}

function mkInv(name, plannedYear, rfAmount, otherFunding) {
  const fp = [{ source: "Remondifond", amountEUR: rfAmount }];
  if (otherFunding) fp.push(otherFunding);
  return {
    id: name, name, plannedYear,
    totalCostEUR: rfAmount + (otherFunding?.amountEUR || 0),
    fundingPlan: fp,
  };
}

// S1: algsaldo katab kõik
describe("S1: algsaldo katab kõik", () => {
  it("rate on 0 kui saldo katab kõik investeeringud", () => {
    const rate = rfRate(30000, [
      mkInv("Katus", 2028, 10000),
      mkInv("Aknad", 2029, 15000),
    ]);
    expect(rate).toBe(0);
  });
});

// S2: üks 2027 investeering, algsaldo ei kata
describe("S2: varane investeering, algsaldo ei kata", () => {
  it("rate katab puudujäägi esimese aasta jooksul", () => {
    // saldo_2027_lõpp = 5000 - 10000 + rate * 100 >= 0
    // rate >= 5000 / 100 = 50 €/m²/a → 4.1667 €/m²/kuu → ceil → 4.17 → aastas 50.04
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "5000",
      investments: [mkInv("Katus", 2027, 10000)],
    });
    expect(r.maarKuusM2).toBe(4.17); // kanoniline kuumäär
    expect(r.maarAastasM2).toBeCloseTo(4.17 * 12, 6); // tuletatud aastas
  });
});

// S3: mitu investeeringut eri aastatel — määr tuleb kitsama aasta järgi
describe("S3: mitu investeeringut, kitsam aasta domineerib", () => {
  it("kolmas aasta on kitsam kui esimene", () => {
    // 2027: 5000 - 10000 + r*100 >= 0 → r >= 50
    // 2029: 5000 - 10000 - 20000 + 3*r*100 >= 0 → r >= 25000/300 = 83.333
    // kitsam: 2029 → kuuCeil(83.333/12) = ceil(6.9444*100)/100 = 6.95
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "5000",
      investments: [
        mkInv("Katus", 2027, 10000),
        mkInv("Fassaad", 2029, 20000),
      ],
    });
    expect(r.maarKuusM2).toBe(6.95); // kanoniline kuumäär
    expect(r.maarAastasM2).toBeCloseTo(6.95 * 12, 6); // tuletatud aastas
  });
});

// S4: osa RF, osa laen — ainult RF osa mõjutab RF määra
describe("S4: segatud rahastus — ainult RF osa mõjutab määra", () => {
  it("laenu osa ei mõjuta RF minimaalset määra (loanScenario)", () => {
    // totalCost 50000, RF osa 20000, laen 30000
    // loanScenario.maarIlmaLaenuta peaks olema 100 (ainult RF osa)
    // Aga maarAastasM2 kasutab maarLaenuga haru (onLaen=true), mis põhineb laenumaksetel
    // Kontrollime maarIlmaLaenuta otse — see on RF min-rate arvutus
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      loanStatus: "APPROVED",
      loans: [{ id: "l1", sepiiriostudInvId: "Katus", principalEUR: 30000, annualRatePct: 4, termMonths: 120 }],
      investments: [{
        id: "Katus", name: "Katus", plannedYear: 2028, totalCostEUR: 50000,
        sourceRefId: "rida-1",
        fundingPlan: [
          { source: "Remondifond", amountEUR: 20000 },
          { source: "Laen", amountEUR: 30000 },
        ],
      }],
    });
    // maarIlmaLaenuta = RF minimaalne ajajoon-rate = 20000 / (2 * 100) = 100
    expect(r.loanScenario.maarIlmaLaenuta).toBe(100);
    // investRemondifondist = ainult RF osa
    expect(r.loanScenario.investRemondifondist).toBe(20000);
  });

  it("APPLIED režiimis segarahastuse RF osa kajastub baseScenario's", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      loanStatus: "APPLIED",
      investments: [{
        id: "Katus", name: "Katus", plannedYear: 2028, totalCostEUR: 50000,
        fundingPlan: [
          { source: "Remondifond", amountEUR: 20000 },
          { source: "Laen", amountEUR: 30000 },
        ],
      }],
    });
    // baseScenario: RF osa kajastub, kuigi laen pole kinnitatud
    expect(r.investRemondifondist).toBe(20000);
    expect(r.maarIlmaLaenuta).toBeGreaterThan(0);
    // loanScenario: investeering sees, RF osa arvestatud
    expect(r.loanScenario.maarIlmaLaenuta).toBe(100);
    expect(r.loanScenario.investRemondifondist).toBe(20000);
  });
});

// S5: hilisem investeering, vahepealne kogumine taastab saldo
describe("S5: vahepealne kogumine taastab saldo", () => {
  it("esimene aasta on bottleneck, mitte hilisem", () => {
    // 2027: 2000 - 8000 + r*100 >= 0 → r >= 60
    // 2030: 2000 - 8000 - 12000 + 4*r*100 >= 0 → r >= 18000/400 = 45
    // kitsam: 2027 (r >= 60)
    const rate = rfRate(2000, [
      mkInv("Katus", 2027, 8000),
      mkInv("Fassaad", 2030, 12000),
    ]);
    expect(rate).toBe(60);
  });
});

// Lisatestid: äärjuhtumid

describe("äärjuhtumid", () => {
  it("investeeringuid pole → rate 0", () => {
    expect(rfRate(5000, [])).toBe(0);
  });

  it("ainult laenuga investeering → rate 0 (RF osa puudub)", () => {
    const rate = rfRate(0, [{
      id: "x", name: "x", plannedYear: 2028, totalCostEUR: 30000,
      fundingPlan: [{ source: "Laen", amountEUR: 30000 }],
    }]);
    expect(rate).toBe(0);
  });

  it("koguPind 0 → rate 0 (jagamine kaitstud)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      koguPind: 0,
      saldoAlgusRaw: "0",
      investments: [mkInv("Katus", 2028, 10000)],
    });
    expect(r.maarAastasM2).toBe(0);
  });
});
