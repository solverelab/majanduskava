import { describe, it, expect } from "vitest";
import { computeKopiiriondvaade, KOMMUNAALTEENUSED } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// INVARIANT: summaInput on kanoniline maksumuse sisend kõigil kuluridadel.
// uhikuHind ei mõjuta arvutust.
// ══════════════════════════════════════════════════════════════════════

describe("summaInput on kanoniline — uhikuHind ei mõjuta arvutust", () => {
  const mkRow = (category, summaInput, uhikuHind) => ({
    id: "r1", side: "COST", category,
    summaInput, kogus: 100, uhik: "MWh", uhikuHind,
    utilityType: "heat",
  });

  it("sama summaInput, erinev uhikuHind → sama tulemus", () => {
    const r1 = computeKopiiriondvaade(
      [mkRow("Soojus", "50000", 500)],
      [], [], 12, "APPLIED"
    );
    const r2 = computeKopiiriondvaade(
      [mkRow("Soojus", "50000", 999)],
      [], [], 12, "APPLIED"
    );
    expect(r1.kommunaalKokku).toBe(r2.kommunaalKokku);
  });

  it("uhikuHind puudub → sama tulemus", () => {
    const r1 = computeKopiiriondvaade(
      [mkRow("Soojus", "50000", 500)],
      [], [], 12, "APPLIED"
    );
    const r2 = computeKopiiriondvaade(
      [mkRow("Soojus", "50000", undefined)],
      [], [], 12, "APPLIED"
    );
    expect(r1.kommunaalKokku).toBe(r2.kommunaalKokku);
  });

  it("erinev summaInput → erinev tulemus (summaInput on kanoniline)", () => {
    const r1 = computeKopiiriondvaade(
      [mkRow("Soojus", "50000", 500)],
      [], [], 12, "APPLIED"
    );
    const r2 = computeKopiiriondvaade(
      [mkRow("Soojus", "60000", 500)],
      [], [], 12, "APPLIED"
    );
    expect(r1.kommunaalKokku).not.toBe(r2.kommunaalKokku);
  });

  it("kehtib kõigile p5 kategooriatele", () => {
    for (const cat of ["Soojus", "Kütus", "Vesi ja kanalisatsioon", "Elekter"]) {
      const r1 = computeKopiiriondvaade(
        [mkRow(cat, "10000", 100)],
        [], [], 12, "APPLIED"
      );
      const r2 = computeKopiiriondvaade(
        [mkRow(cat, "10000", 999)],
        [], [], 12, "APPLIED"
      );
      expect(r1.kommunaalKokku).toBe(r2.kommunaalKokku);
    }
  });

  it("name väli ei mõjuta arvutust (fuel alamliik on vabatekst)", () => {
    const base = { id: "r1", side: "COST", category: "Kütus", summaInput: "5000", utilityType: "fuel" };
    const r1 = computeKopiiriondvaade([{ ...base, name: "Gaasküte" }], [], [], 12, "APPLIED");
    const r2 = computeKopiiriondvaade([{ ...base, name: "" }], [], [], 12, "APPLIED");
    const r3 = computeKopiiriondvaade([{ ...base, name: "Pelletiküte" }], [], [], 12, "APPLIED");
    expect(r1.kommunaalKokku).toBe(r2.kommunaalKokku);
    expect(r1.kommunaalKokku).toBe(r3.kommunaalKokku);
  });
});
