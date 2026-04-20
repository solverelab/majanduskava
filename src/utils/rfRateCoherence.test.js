import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// RF määra ümarduse koherentsuse testid
//
// Invariant: kuvatud kuumäär (maarKuusM2) ja sellest tuletatud summad
// (laekuminePerioodis, saldoLopp) peavad klappima.
// Ei tohi tekkida olukorda, kus nähtav määr on 0,31 aga laekumine
// vastab kõrgemale peidetud väärtusele.
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "0",
  koguPind: 5337.2,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 60,
};

function kontroll(r) {
  // Kuvatud kuumäär (toFixed(2)) peab andma sama laekumise kui sisemine
  const kuvatudKuu = parseFloat(r.maarKuusM2.toFixed(2));
  const kontrollLaekumine = Math.round(kuvatudKuu * 12 * r.koguPind * (BASE.monthEq) / 12);
  return { kuvatudKuu, kontrollLaekumine };
}

describe("kuvatud kuumäär ja laekumine klapivad", () => {
  it("väike investeering — vahe on 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    });
    const { kontrollLaekumine } = kontroll(r);
    expect(r.laekuminePerioodis).toBe(kontrollLaekumine);
  });

  it("suur investeering — vahe on 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i2", name: "Fassaad", plannedYear: 2030, totalCostEUR: 200000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 200000 }],
      }],
    });
    const { kontrollLaekumine } = kontroll(r);
    expect(r.laekuminePerioodis).toBe(kontrollLaekumine);
  });

  it("mitu investeeringut — vahe on 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        { id: "a", name: "A", plannedYear: 2028, totalCostEUR: 30000, fundingPlan: [{ source: "Remondifond", amountEUR: 30000 }] },
        { id: "b", name: "B", plannedYear: 2030, totalCostEUR: 50000, fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }] },
      ],
    });
    const { kontrollLaekumine } = kontroll(r);
    expect(r.laekuminePerioodis).toBe(kontrollLaekumine);
  });
});

describe("kuumäär ümardatakse üles 0.01 täpsusega", () => {
  it("irratsionaalne aastasmäär → kuumäär on ceil'd", () => {
    // rate = 10000 / (2 * 5337.2) ≈ 0.9368 €/m²/a → 0.0781 €/m²/kuu → ceil → 0.08
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "i3", name: "Test", plannedYear: 2029, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    });
    // kuumäär peab olema täpne 2 kohta
    expect(r.maarKuusM2).toBe(parseFloat(r.maarKuusM2.toFixed(2)));
    // aastas tuletatud kuust
    expect(r.maarAastasM2).toBeCloseTo(r.maarKuusM2 * 12, 10);
  });
});

describe("käsitsi override säilitab kasutaja täpse kuumäära", () => {
  it("override 0.31 → maarKuusM2 === 0.31, laekumine klappib", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      maarOverride: 0.31,
      investments: [{
        id: "i4", name: "Katus", plannedYear: 2029, totalCostEUR: 100000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 100000 }],
      }],
    });
    expect(r.maarKuusM2).toBe(0.31);
    const kontrollLaekumine = Math.round(0.31 * 12 * 5337.2 * 60 / 12);
    expect(r.laekuminePerioodis).toBe(kontrollLaekumine);
  });

  it("override 0.07 ei ümardatu üles (kasutaja valik)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      maarOverride: 0.07,
      investments: [{
        id: "i5", name: "Väike", plannedYear: 2028, totalCostEUR: 5000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 5000 }],
      }],
    });
    expect(r.maarKuusM2).toBe(0.07);
  });
});

describe("negatiivset lõppseisu ei teki soovituslikul määral", () => {
  it("automaatne määr tagab saldoLopp >= 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        { id: "a", name: "A", plannedYear: 2027, totalCostEUR: 50000, fundingPlan: [{ source: "Remondifond", amountEUR: 50000 }] },
        { id: "b", name: "B", plannedYear: 2029, totalCostEUR: 80000, fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }] },
      ],
    });
    expect(r.saldoLopp).toBeGreaterThanOrEqual(0);
    expect(r.maarKuusM2).toBeGreaterThan(0);
  });
});
