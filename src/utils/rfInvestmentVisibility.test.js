import { describe, it, expect } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Investeeringu RF osa nähtavus "Fondid ja laen" tabis
//
// Probleem: segarahastusega investeering (RF + Laen) filtreerus
// baseScenario-st TERVIKUNA välja, sest isConditional() liigitas
// kogu investeeringu tingimuslikuks. Tulemus: RF osa ei kajastunud.
//
// Parandus: baseScenario kasutab nüüd koikInv (kõik investeeringud),
// mitte ainult kindladInv (laenuta investeeringud).
// ══════════════════════════════════════════════════════════════════════

const BASE = {
  saldoAlgusRaw: "0",
  koguPind: 100,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 60,
};

describe("segarahastuse investeering (RF + Laen) kajastub RF arvutuses", () => {
  const mixedInv = [{
    id: "inv1",
    name: "Katus",
    plannedYear: 2029,
    totalCostEUR: 10000,
    fundingPlan: [
      { source: "Remondifond", amountEUR: 2000 },
      { source: "Laen", amountEUR: 8000 },
    ],
  }];

  it("RF osa jõuab invArvutusread-sse ka kui laen pole kinnitatud", () => {
    const ra = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPLIED",
      investments: mixedInv,
    });

    expect(ra.invArvutusread.length).toBeGreaterThan(0);
    expect(ra.investRemondifondist).toBe(2000);
    expect(ra.invArvutusread[0].nimetus).toBe("Katus");
    expect(ra.invArvutusread[0].rfSumma).toBe(2000);
  });

  it("RF määr > 0 segarahastusega investeeringu puhul", () => {
    const ra = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPLIED",
      investments: mixedInv,
    });

    expect(ra.maarAastasM2).toBeGreaterThan(0);
    expect(ra.maarKuusM2).toBeGreaterThan(0);
  });

  it("laenu kinnitamine ei muuda RF osa summat", () => {
    const applied = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPLIED",
      investments: mixedInv,
    });
    const approved = computeRemondifondiArvutus({
      ...BASE,
      loanStatus: "APPROVED",
      investments: mixedInv,
    });

    expect(applied.investRemondifondist).toBe(approved.investRemondifondist);
    expect(applied.invArvutusread.length).toBe(approved.invArvutusread.length);
    expect(applied.invArvutusread[0].rfSumma).toBe(approved.invArvutusread[0].rfSumma);
  });
});

describe("ainult laenuga investeering ei lähe RF alla", () => {
  it("investeering ilma RF allikata → invArvutusread tühi", () => {
    const ra = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "inv2",
        name: "Lift",
        plannedYear: 2029,
        totalCostEUR: 50000,
        fundingPlan: [{ source: "Laen", amountEUR: 50000 }],
      }],
    });

    expect(ra.invArvutusread.length).toBe(0);
    expect(ra.investRemondifondist).toBe(0);
  });
});

describe("ainult RF investeering töötab endiselt", () => {
  it("puhas RF investeering kajastub korrektselt", () => {
    const ra = computeRemondifondiArvutus({
      ...BASE,
      investments: [{
        id: "inv3",
        name: "Fassaad",
        plannedYear: 2030,
        totalCostEUR: 15000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 15000 }],
      }],
    });

    expect(ra.invArvutusread.length).toBe(1);
    expect(ra.investRemondifondist).toBe(15000);
    expect(ra.maarAastasM2).toBeGreaterThan(0);
  });
});

describe("mitu investeeringut korraga", () => {
  it("sega + puhas RF → mõlemad kajastuvad", () => {
    const ra = computeRemondifondiArvutus({
      ...BASE,
      investments: [
        {
          id: "inv4", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
          fundingPlan: [
            { source: "Remondifond", amountEUR: 2000 },
            { source: "Laen", amountEUR: 8000 },
          ],
        },
        {
          id: "inv5", name: "Fassaad", plannedYear: 2030, totalCostEUR: 5000,
          fundingPlan: [{ source: "Remondifond", amountEUR: 5000 }],
        },
      ],
    });

    expect(ra.invArvutusread.length).toBe(2);
    expect(ra.investRemondifondist).toBe(7000);
  });
});
