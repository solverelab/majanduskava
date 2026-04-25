import { describe, it, expect } from "vitest";
import {
  UTILITY_TYPE_BY_CATEGORY, utilityTypeForRow,
  computeRemondifondiArvutus,
} from "./majanduskavaCalc";
import { mkCashflowRow } from "../domain/planSchema";

// ══════════════════════════════════════════════════════════════════════
// KrtS § 41 lg 1 p 5 — utilityType eristus
// ══════════════════════════════════════════════════════════════════════

describe("UTILITY_TYPE_BY_CATEGORY mapping", () => {
  it("katab kõik p 5 liiki", () => {
    expect(UTILITY_TYPE_BY_CATEGORY["Soojus"]).toBe("heat");
    expect(UTILITY_TYPE_BY_CATEGORY["Kütus"]).toBe("fuel");
    expect(UTILITY_TYPE_BY_CATEGORY["Vesi ja kanalisatsioon"]).toBe("water_sewer");
    expect(UTILITY_TYPE_BY_CATEGORY["Elekter"]).toBe("electricity");
    expect(UTILITY_TYPE_BY_CATEGORY["Muu kommunaalteenus"]).toBe("other");
  });

  it("ei kata mitte-p5 kategooriaid", () => {
    expect(UTILITY_TYPE_BY_CATEGORY["Haldus"]).toBeUndefined();
    expect(UTILITY_TYPE_BY_CATEGORY["Prügivedu"]).toBeUndefined();
  });
});

describe("utilityTypeForRow", () => {
  it("eksplitsiitne utilityType on eelistatud", () => {
    expect(utilityTypeForRow({ utilityType: "heat", category: "Kütus" })).toBe("heat");
  });

  it("fallback category kaudu", () => {
    expect(utilityTypeForRow({ category: "Soojus" })).toBe("heat");
    expect(utilityTypeForRow({ category: "Elekter" })).toBe("electricity");
  });

  it("tavaline kulurida → null", () => {
    expect(utilityTypeForRow({ category: "Haldus" })).toBeNull();
    expect(utilityTypeForRow({ category: "" })).toBeNull();
    expect(utilityTypeForRow({})).toBeNull();
  });

  it("vana rida ilma utilityType väljata → category fallback", () => {
    const vanaRida = { id: "x", category: "Vesi ja kanalisatsioon", summaInput: 500 };
    expect(utilityTypeForRow(vanaRida)).toBe("water_sewer");
  });
});

describe("mkCashflowRow utilityType väli", () => {
  it("vaikimisi null", () => {
    const row = mkCashflowRow();
    expect(row.utilityType).toBeNull();
  });

  it("saab määrata", () => {
    const row = mkCashflowRow({ utilityType: "heat" });
    expect(row.utilityType).toBe("heat");
  });
});

describe("tagasiühilduvus", () => {
  it("JSON roundtrip säilitab utilityType", () => {
    const row = mkCashflowRow({ category: "Soojus", utilityType: "heat" });
    const parsed = JSON.parse(JSON.stringify(row));
    expect(parsed.utilityType).toBe("heat");
  });

  it("vana JSON ilma utilityType väljata → utilityTypeForRow fallback", () => {
    const json = '{"id":"x","side":"COST","category":"Elekter","summaInput":1200}';
    const parsed = JSON.parse(json);
    expect(parsed.utilityType).toBeUndefined();
    expect(utilityTypeForRow(parsed)).toBe("electricity");
  });

  it("vana JSON mitte-p5 kategooriaga → null", () => {
    const json = '{"id":"x","side":"COST","category":"Kindlustus","summaInput":300}';
    const parsed = JSON.parse(json);
    expect(utilityTypeForRow(parsed)).toBeNull();
  });
});

describe("arvutusloogika ei muutu", () => {
  it("computeRemondifondiArvutus ei sõltu utilityType'ist", () => {
    const BASE = {
      saldoAlgusRaw: "0", koguPind: 200, periodiAasta: 2027,
      pangaKoef: 1.15, kogumisViis: "eraldi",
      pangaMaarOverride: null, maarOverride: null,
      loans: [], loanStatus: "APPLIED", monthEq: 60,
      investments: [{
        id: "i1", name: "Katus", plannedYear: 2029, totalCostEUR: 10000,
        fundingPlan: [{ source: "Remondifond", amountEUR: 10000 }],
      }],
    };
    const r = computeRemondifondiArvutus(BASE);
    expect(r.investRemondifondist).toBeGreaterThan(0);
    expect(r.investRemondifondist).toBe(10000);
  });
});

describe("print p5 ridade kuvamisloogika", () => {
  // Simuleerime print rea koostamise loogikat
  function printRowParts(r) {
    const ut = utilityTypeForRow(r);
    const parts = [];
    if (r.category) parts.push(r.category);
    if (r.category && r.name) parts.push(r.name);
    else if (!r.category) parts.push("—");
    if (ut) {
      if (r.kogus) {
        parts.push(`${r.kogus} ${r.uhik || ""}`.trim());
      } else {
        parts.push("kogus määramata");
      }
    }
    return parts;
  }

  it("p5 täielik: liik + nimi + kogus ühik", () => {
    const parts = printRowParts({
      category: "Soojus", name: "Kaugküte", kogus: 150, uhik: "MWh",
      summaInput: 50000, utilityType: "heat",
    });
    expect(parts).toEqual(["Soojus", "Kaugküte", "150 MWh"]);
  });

  it("p5 ilma nimeta: liik + kogus ühik, tühja eraldajat pole", () => {
    const parts = printRowParts({
      category: "Elekter", name: "", kogus: 8500, uhik: "kWh",
      summaInput: 1200, utilityType: "electricity",
    });
    expect(parts).toEqual(["Elekter", "8500 kWh"]);
  });

  it("p5 puuduva kogusega: liik + 'kogus määramata'", () => {
    const parts = printRowParts({
      category: "Vesi ja kanalisatsioon", name: "", kogus: "", uhik: "m³",
      summaInput: 3000, utilityType: "water_sewer",
    });
    expect(parts).toEqual(["Vesi ja kanalisatsioon", "kogus määramata"]);
  });

  it("p5 puuduva kogusega (0): sama 'kogus määramata'", () => {
    const parts = printRowParts({
      category: "Kütus", name: "Gaas", kogus: 0, uhik: "m³",
      summaInput: 5000, utilityType: "fuel",
    });
    expect(parts).toEqual(["Kütus", "Gaas", "kogus määramata"]);
  });

  it("mitte-p5 rida: pole koguse/ühiku infot", () => {
    const parts = printRowParts({
      category: "Haldus", name: "", kogus: 12, uhik: "kuu", summaInput: 6000,
    });
    expect(parts).toEqual(["Haldus"]);
    // kogust ei kuvata, kuigi see on olemas
  });

  it("mitte-p5 rida nimega: kategooria + nimi", () => {
    const parts = printRowParts({
      category: "Muu haldusteenus", name: "Valve", summaInput: 200,
    });
    expect(parts).toEqual(["Muu haldusteenus", "Valve"]);
  });

  it("kategooriata rida: kuvab —", () => {
    const parts = printRowParts({ category: "", name: "", summaInput: 100 });
    expect(parts).toEqual(["—"]);
  });
});
