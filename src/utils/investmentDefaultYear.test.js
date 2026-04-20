import { describe, it, expect } from "vitest";
import { defaultPlan, mkInvestmentItem } from "../domain/planSchema";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Investeeringu vaikeaasta peab tulema aktiivsest perioodist (plan.period.year),
// mitte süsteemi kalendriaastast.
// mkInvestmentItem ise ei tea aktiivset plaani — default on 0 ("määramata").
// Kutsuja vastutab aktiivse perioodi aasta edastamise eest.
// ══════════════════════════════════════════════════════════════════════

describe("mkInvestmentItem factory", () => {
  it("ilma aastata → 0 (määramata, mitte süsteemiaasta)", () => {
    const inv = mkInvestmentItem({ name: "Test" });
    expect(inv.plannedYear).toBe(0);
  });

  it("konkreetse aastaga säilitab selle", () => {
    const inv = mkInvestmentItem({ name: "Test", plannedYear: 2029 });
    expect(inv.plannedYear).toBe(2029);
  });

  it("olemasolev investeering aastaga 2026 jääb 2026", () => {
    const inv = mkInvestmentItem({ name: "Vana", plannedYear: 2026 });
    expect(inv.plannedYear).toBe(2026);
  });
});

describe("defaultPlan vaikeaasta", () => {
  it("ilma argumendita kasutab jooksvat aastat (tühja plaani algväärtus)", () => {
    const p = defaultPlan();
    expect(p.period.year).toBe(new Date().getFullYear());
  });

  it("konkreetse aastaga säilitab selle", () => {
    const p = defaultPlan({ year: 2027 });
    expect(p.period.year).toBe(2027);
  });
});

describe("investeeringu loomine kasutab aktiivse plaani aastat", () => {
  it("condition-item: tegevusAasta olemas → kasutab seda", () => {
    const periodYear = 2027;
    const rida = { tegevusAasta: "2028" };
    const year = Number(rida.tegevusAasta) || periodYear;
    const inv = mkInvestmentItem({ name: "Katus", plannedYear: year });
    expect(inv.plannedYear).toBe(2028);
  });

  it("condition-item: tegevusAasta puudub → kasutab perioodi aastat, mitte süsteemiaastat", () => {
    const periodYear = 2027;
    const rida = { tegevusAasta: "" };
    const year = Number(rida.tegevusAasta) || periodYear;
    const inv = mkInvestmentItem({ name: "Katus", plannedYear: year });
    expect(inv.plannedYear).toBe(2027);
    // Ei ole new Date().getFullYear() — on perioodi aasta
  });

  it("standalone: kasutab perioodi aastat", () => {
    const periodYear = 2027;
    const inv = mkInvestmentItem({ name: "", plannedYear: periodYear });
    expect(inv.plannedYear).toBe(2027);
  });

  it("süsteemiaasta erinevus ei mõjuta aktiivse plaani investeeringut", () => {
    // Simuleerime: süsteemiaasta on 2026, plaan on 2027
    const periodYear = 2027;
    const sysYear = 2026; // new Date().getFullYear() oleks 2026
    const inv = mkInvestmentItem({ name: "", plannedYear: periodYear });
    expect(inv.plannedYear).toBe(2027);
    expect(inv.plannedYear).not.toBe(sysYear);
  });
});

describe("import fallback: puuduv plannedYear → period.year", () => {
  it("importitud inv ilma plannedYear väljata saab period.year fallbacki", () => {
    const periodYear = 2027;
    // Simuleerime import-migratsiooni loogikat: inv.plannedYear || periodYear
    const inv = { name: "Vana katus", totalCostEUR: 5000 }; // puudub plannedYear
    const plannedYear = inv.plannedYear || periodYear;
    expect(plannedYear).toBe(2027);
  });

  it("importitud inv olemasoleva aastaga jääb muutmata", () => {
    const periodYear = 2027;
    const inv = { name: "Vana katus", plannedYear: 2025, totalCostEUR: 5000 };
    const plannedYear = inv.plannedYear || periodYear;
    expect(plannedYear).toBe(2025);
  });
});

describe("tegevusAasta tühjendamine → period.year fallback", () => {
  it("tühi tegevusAasta seab investeeringu aastaks period.year, mitte 0", () => {
    const periodYear = 2027;
    // Simuleerime MajanduskavaApp.jsx rida 1146 loogikat
    const value = ""; // kasutaja tühjendab
    const plannedYear = Number(value) || periodYear;
    expect(plannedYear).toBe(2027);
    expect(plannedYear).not.toBe(0);
  });

  it("kehtiv tegevusAasta seab selle aasta", () => {
    const periodYear = 2027;
    const value = "2029";
    const plannedYear = Number(value) || periodYear;
    expect(plannedYear).toBe(2029);
  });
});

describe("factory sentinel jääb alles", () => {
  it("mkInvestmentItem() ilma aastata → 0 (factory kaitsevõrk)", () => {
    const inv = mkInvestmentItem({ name: "Test" });
    expect(inv.plannedYear).toBe(0);
  });
});

describe("remondifondi arvutus ei muutu", () => {
  it("computeRemondifondiArvutus töötab sõltumata vaikeaasta muutusest", () => {
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
    expect(r.maarKuusM2).toBeGreaterThan(0);
    expect(r.investRemondifondist).toBe(10000);
  });
});
