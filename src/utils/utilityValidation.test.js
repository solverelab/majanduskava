import { describe, it, expect } from "vitest";
import { utilityRowStatus, computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// P 5 rea täielikkuse validatsioon
// ══════════════════════════════════════════════════════════════════════

describe("utilityRowStatus", () => {
  it("p5 rida täielike andmetega → complete", () => {
    const s = utilityRowStatus({
      category: "Soojus", utilityType: "heat",
      kogus: 150, uhik: "MWh", summaInput: 50000,
    });
    expect(s.isUtility).toBe(true);
    expect(s.complete).toBe(true);
    expect(s.missing).toEqual([]);
  });

  it("p5 rida puuduva kogusega → missing kogus", () => {
    const s = utilityRowStatus({
      category: "Elekter", utilityType: "electricity",
      kogus: "", uhik: "kWh", summaInput: 3000,
    });
    expect(s.isUtility).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.missing).toContain("kogus");
    expect(s.missing).not.toContain("ühik");
  });

  it("p5 rida kogus = 0 → missing kogus", () => {
    const s = utilityRowStatus({
      category: "Kütus", utilityType: "fuel",
      kogus: 0, uhik: "m³", summaInput: 5000,
    });
    expect(s.complete).toBe(false);
    expect(s.missing).toContain("kogus");
  });

  it("p5 rida puuduva ühikuga → missing ühik", () => {
    const s = utilityRowStatus({
      category: "Vesi ja kanalisatsioon", utilityType: "water_sewer",
      kogus: 200, uhik: "", summaInput: 2000,
    });
    expect(s.isUtility).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.missing).toContain("ühik");
    expect(s.missing).not.toContain("kogus");
  });

  it("p5 rida puuduva koguse ja ühikuga → mõlemad missing", () => {
    const s = utilityRowStatus({
      category: "Soojus", utilityType: "heat",
      kogus: "", uhik: "", summaInput: 10000,
    });
    expect(s.complete).toBe(false);
    expect(s.missing).toEqual(["kogus", "ühik"]);
  });

  it("mitte-p5 rida → isUtility false, always complete", () => {
    const s = utilityRowStatus({
      category: "Haldus", kogus: "", uhik: "", summaInput: 6000,
    });
    expect(s.isUtility).toBe(false);
    expect(s.complete).toBe(true);
    expect(s.missing).toEqual([]);
  });

  it("mitte-p5 rida puuduva kõigega → ikkagi complete", () => {
    const s = utilityRowStatus({ category: "Prügivedu" });
    expect(s.isUtility).toBe(false);
    expect(s.complete).toBe(true);
  });

  it("vana rida ilma utilityType väljata → category fallback", () => {
    const s = utilityRowStatus({
      category: "Elekter", kogus: 5000, uhik: "kWh", summaInput: 1200,
    });
    expect(s.isUtility).toBe(true);
    expect(s.complete).toBe(true);
  });
});

describe("arvutusloogika ei muutu", () => {
  it("computeRemondifondiArvutus ei sõltu utilityRowStatus-est", () => {
    const r = computeRemondifondiArvutus({
      saldoAlgusRaw: "0", koguPind: 200, periodiAasta: 2027,
      pangaKoef: 1.15, kogumisViis: "eraldi",
      pangaMaarOverride: null, maarOverride: null,
      loans: [], loanStatus: "APPLIED", monthEq: 60,
      investments: [{
        id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    });
    expect(r.investRemondifondist).toBeGreaterThan(0);
  });
});
