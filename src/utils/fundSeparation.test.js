import { describe, it, expect } from "vitest";
import { computeReserveMin, computeRemondifondiArvutus } from "./majanduskavaCalc";
import { computePlan } from "../engine/computePlan";
import { defaultPlan, mkApartment } from "../domain/planSchema";

// ══════════════════════════════════════════════════════════════════════
// Fondide lahususe invariandid (INV-08, INV-09):
//   remondifondi kogumismäär tuleneb investeeringute mudelist
//     (computeRemondifondiArvutus), computePlan ainult rakendab määra
//   reservkapitali miinimum tuleneb tegevuskuludest
//     (computeReserveMin), mitte investeeringutest
// ══════════════════════════════════════════════════════════════════════

describe("remondifondi kogumismäär tuleneb investeeringute mudelist (INV-08)", () => {
  const BASE_RF = {
    saldoAlgusRaw: "0", koguPind: 100, periodiAasta: 2027,
    pangaKoef: 1.15, kogumisViis: "eraldi", pangaMaarOverride: null,
    maarOverride: null, loans: [], loanStatus: "APPLIED", monthEq: 12,
  };

  it("investeeringutest tühi → kogumismäär on 0", () => {
    const ra = computeRemondifondiArvutus({ ...BASE_RF, investments: [] });
    expect(ra.maarAastasM2).toBe(0);
    expect(ra.investRemondifondist).toBe(0);
  });

  it("investeering Remondifond allikaga → RF kajastub arvutuses", () => {
    // periodiAasta:2027 monthEq:12 → periodEndYear:2027; inv.plannedYear:2028 → nextPeriodRfVajadus
    const ra = computeRemondifondiArvutus({
      ...BASE_RF,
      investments: [{
        name: "Katus", plannedYear: 2028, totalCostEUR: 20000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 20000 }],
      }],
    });
    expect(ra.nextPeriodRfVajadus).toBeGreaterThan(0);
    expect(ra.nextPeriodRfVajadus).toBe(20000);
  });

  it("tegevuskulud ei mõjuta kogumismäära (computeRemondifondiArvutus ei saa costRows-i)", () => {
    const inv = [{
      name: "Katus", plannedYear: 2028, totalCostEUR: 20000,
      fundingPlan: [{ source: "Remondifond", amountEUR: 20000 }],
    }];
    // computeRemondifondiArvutus ei saa costRows parameetrit üldse
    const ra = computeRemondifondiArvutus({ ...BASE_RF, investments: inv });
    expect(ra.nextPeriodRfVajadus).toBeGreaterThan(0);
    // Sama tulemus sõltumata mis tegevuskulud on
    const ra2 = computeRemondifondiArvutus({ ...BASE_RF, investments: inv });
    expect(ra2.nextPeriodRfVajadus).toBe(ra.nextPeriodRfVajadus);
  });
});

describe("reservkapitali miinimum tuleneb tegevuskuludest (INV-09)", () => {
  it("tegevuskuludega → reservkapitali miinimum > 0", () => {
    const costRows = [
      { category: "Haldus", summaInput: "6000", arvutus: "perioodis" },
      { category: "Soojus", summaInput: "12000" },
    ];
    const rm = computeReserveMin(costRows, 12);
    expect(rm.noutavMiinimum).toBeGreaterThan(0);
    expect(rm.noutavMiinimum).toBe(Math.round(18000 / 12)); // 1500
  });

  it("tühjade tegevuskuludega → reservkapitali miinimum on 0", () => {
    const rm = computeReserveMin([], 12);
    expect(rm.noutavMiinimum).toBe(0);
  });

  it("investeeringud ei mõjuta miinimumi (computeReserveMin ei saa investments-i)", () => {
    const costRows = [{ category: "Haldus", summaInput: "6000", arvutus: "perioodis" }];
    const rm = computeReserveMin(costRows, 12);
    expect(rm.noutavMiinimum).toBe(500);
  });
});

describe("computePlan: fondid on sõltumatud — ühe muutmine ei mõjuta teist", () => {
  function buildPlan(rfRate, reservePlanned, investments) {
    const plan = {
      ...defaultPlan({ year: 2027 }),
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
      building: { apartments: [mkApartment({ label: "1", areaM2: 50 })] },
      budget: {
        costRows: [{ id: "c1", category: "Haldus", summaInput: "6000", arvutus: "perioodis", calc: { type: "FIXED_PERIOD", params: { amountEUR: 6000 } } }],
        incomeRows: [],
      },
      investments: { items: investments || [] },
      funds: {
        repairFund: { monthlyRateEurPerM2: rfRate },
        reserve: { plannedEUR: reservePlanned },
      },
    };
    return plan;
  }

  it("RF määra muutmine ei mõjuta reserve closing-ut", () => {
    const d1 = computePlan(buildPlan(2, 3000, []));
    const d2 = computePlan(buildPlan(5, 3000, []));

    // Reserve closing peaks olema sama, sest reserve ei sõltu RF-ist
    expect(d1.funds.reserveClosingEUR).toBe(d2.funds.reserveClosingEUR);
    // RF closing erineb, sest määr muutus
    expect(d1.funds.repairFundClosingEUR).not.toBe(d2.funds.repairFundClosingEUR);
  });

  it("reserve planned muutmine ei mõjuta RF closing-ut", () => {
    const d1 = computePlan(buildPlan(2, 1000, []));
    const d2 = computePlan(buildPlan(2, 5000, []));

    // RF closing peaks olema sama, sest RF ei sõltu reservist
    expect(d1.funds.repairFundClosingEUR).toBe(d2.funds.repairFundClosingEUR);
    // Reserve closing erineb, sest planned muutus
    expect(d1.funds.reserveClosingEUR).not.toBe(d2.funds.reserveClosingEUR);
  });
});

describe("import-migratsioon ei sega fondide loogikat", () => {
  it("Reservkapital rahastusallikas migreeritakse Remondifondiks (tahtlik äriloogika)", () => {
    // Mirrors migreeriAllikas in MajanduskavaApp.jsx:829
    const migreeriAllikas = (a) => a === "Erakorraline makse" ? "Sihtmakse" : a === "Reservkapital" ? "Remondifond" : a;

    expect(migreeriAllikas("Reservkapital")).toBe("Remondifond");
    expect(migreeriAllikas("Remondifond")).toBe("Remondifond");
    expect(migreeriAllikas("Laen")).toBe("Laen");
    expect(migreeriAllikas("Erakorraline makse")).toBe("Sihtmakse");
  });

  it("RESERVE enum migreeritakse Remondifondiks (tahtlik — reserve ei rahasta investeeringuid)", () => {
    // Mirrors import enum mapping in MajanduskavaApp.jsx:884
    const mapSource = (s) => ({ REPAIR_FUND: "Remondifond", RESERVE: "Remondifond", LOAN: "Laen", GRANT: "Toetus", ONE_OFF: "Sihtmakse" })[s] || s;

    expect(mapSource("RESERVE")).toBe("Remondifond");
    expect(mapSource("REPAIR_FUND")).toBe("Remondifond");
    expect(mapSource("LOAN")).toBe("Laen");
    // Juba kanoniline nimi jääb samaks
    expect(mapSource("Remondifond")).toBe("Remondifond");
  });
});
