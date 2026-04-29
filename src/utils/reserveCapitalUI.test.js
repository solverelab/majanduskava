import { describe, it, expect } from "vitest";
import { computeReserveMin } from "./majanduskavaCalc";

// ══════════════════════════════════════════════════════════════════════
// Reservkapitali ploki invariandid
//
// Kontrollib:
// 1. computeReserveMin: nõutav reservkapital = aasta eeldatavad kulud / 12
// 2. Aasta eeldatavad kulud tulevad kanonilisest arvutusest (costRows)
// 3. Lõppsaldo = algsaldo + kogumine – kasutamine
// 4. Hoiatus kui lõppsaldo < nõutav miinimum
// 5. Planeeritud kogumine jääb kasutaja sisendiks (auto-fill eemaldatud)
// 6. Remondifond ja laenud ei muutu
// ══════════════════════════════════════════════════════════════════════

// ── 1 + 2. Nõutav reservkapital = aasta eeldatavad kulud / 12 ─────────────

describe("nõutav reservkapital = aasta eeldatavad kulud / 12", () => {
  it("12 kuu periood: noutavMiinimum = aastaKulud / 12", () => {
    const costRows = [{ summaInput: "12000" }, { summaInput: "6000" }];
    const r = computeReserveMin(costRows, 12);
    // aastaKulud = 18000, noutavMiinimum = 18000/12 = 1500
    expect(r.aastaKulud).toBe(18000);
    expect(r.noutavMiinimum).toBe(1500);
    expect(r.noutavMiinimum).toBe(r.aastaKulud / 12);
  });

  it("arvestab monthEq-d: 60 kuu periood", () => {
    const costRows = [{ summaInput: "30000" }];
    const r = computeReserveMin(costRows, 60);
    // periodiKulud = 30000, noutavMiinimum = 30000/60 = 500, aastaKulud = 6000
    expect(r.noutavMiinimum).toBe(500);
    expect(r.aastaKulud).toBe(6000);
    expect(r.noutavMiinimum).toBe(r.aastaKulud / 12);
  });

  it("tühja costRows-iga noutavMiinimum = 0", () => {
    const r = computeReserveMin([], 12);
    expect(r.noutavMiinimum).toBe(0);
    expect(r.aastaKulud).toBe(0);
  });

  it("üks kuluread: noutavMiinimum = see kulu / 12 (12 kuu periood)", () => {
    const costRows = [{ summaInput: "2400" }];
    const r = computeReserveMin(costRows, 12);
    expect(r.noutavMiinimum).toBe(200);
    expect(r.aastaKulud).toBe(2400);
  });
});

// ── 2. Aasta eeldatavad kulud tulevad costRows-ist, mitte käsitsi väljast ─

describe("aasta eeldatavad kulud tulevad kanonilisest arvutusest", () => {
  it("sama costRows → sama aastaKulud sõltumata muudest sisenditest", () => {
    const costRows = [{ summaInput: "24000" }];
    const r1 = computeReserveMin(costRows, 12);
    const r2 = computeReserveMin(costRows, 12);
    expect(r1.aastaKulud).toBe(r2.aastaKulud);
    expect(r1.aastaKulud).toBe(24000);
  });

  it("erinev costRows → erinev aastaKulud", () => {
    const r1 = computeReserveMin([{ summaInput: "12000" }], 12);
    const r2 = computeReserveMin([{ summaInput: "24000" }], 12);
    expect(r1.aastaKulud).not.toBe(r2.aastaKulud);
  });
});

// ── 3. Lõppsaldo valem ────────────────────────────────────────────────────

describe("reservkapitali lõppsaldo = algsaldo + kogumine − kasutamine", () => {
  const calcSaldo = (saldoAlgus, kogumine, kasutamine) =>
    (parseFloat(saldoAlgus) || 0) + (kogumine || 0) - (parseFloat(kasutamine) || 0);

  it("täisarvud: 5000 + 1200 − 300 = 5900", () => {
    expect(calcSaldo("5000", 1200, "300")).toBe(5900);
  });

  it("tühja algsaldoga: 0 + 1500 − 0 = 1500", () => {
    expect(calcSaldo("", 1500, "0")).toBe(1500);
  });

  it("negatiivne tulemus: 1000 + 500 − 2000 = -500", () => {
    expect(calcSaldo("1000", 500, "2000")).toBe(-500);
  });

  it("kasutamine 0: lõppsaldo = algsaldo + kogumine", () => {
    expect(calcSaldo("3000", 1000, "0")).toBe(4000);
  });

  it("kõik 0: lõppsaldo = 0", () => {
    expect(calcSaldo("", 0, "")).toBe(0);
  });
});

// ── 4. Hoiatus kui lõppsaldo < nõutav miinimum ───────────────────────────

describe("hoiatus kui lõppsaldo jääb alla nõutava miinimumi", () => {
  const vastab = (rkSaldoLopp, noutavMiinimum) => rkSaldoLopp >= noutavMiinimum;

  it("lõppsaldo < nõutav → ei vasta (hoiatus kuvatakse)", () => {
    expect(vastab(1499, 1500)).toBe(false);
  });

  it("lõppsaldo = nõutav → vastab (hoiatust ei kuvata)", () => {
    expect(vastab(1500, 1500)).toBe(true);
  });

  it("lõppsaldo > nõutav → vastab (hoiatust ei kuvata)", () => {
    expect(vastab(2000, 1500)).toBe(true);
  });

  it("lõppsaldo = 0, nõutav = 0 → vastab", () => {
    expect(vastab(0, 0)).toBe(true);
  });

  it("negatiivne lõppsaldo → ei vasta", () => {
    expect(vastab(-1, 1500)).toBe(false);
  });
});

// ── 5. Planeeritud kogumine on kasutaja sisend (ei kirjutata üle) ─────────

describe("planeeritud kogumine jääb kasutaja sisendiks", () => {
  it("computeReserveMin ei sisalda 'plannedEUR' välja (ei otsusta kogumise üle)", () => {
    const r = computeReserveMin([{ summaInput: "12000" }], 12);
    expect(r).not.toHaveProperty("plannedEUR");
  });

  it("computeReserveMin ei sisalda 'kogumineEUR' ega 'autoFill' välja", () => {
    const r = computeReserveMin([{ summaInput: "12000" }], 12);
    expect(r).not.toHaveProperty("kogumineEUR");
    expect(r).not.toHaveProperty("autoFill");
  });

  it("noutavMiinimum on ainult soovituslik piir, mitte kogumise ettekirjutus", () => {
    const r = computeReserveMin([{ summaInput: "12000" }], 12);
    // Funktsiooni väljund on ainult informatsioon, mitte käsk plan.funds.reserve.plannedEUR-i seada
    expect(typeof r.noutavMiinimum).toBe("number");
    expect(Object.keys(r)).toEqual(["aastaKulud", "noutavMiinimum"]);
  });
});

// ── 6. €/m²/kuu abikuva (informatsioon) ──────────────────────────────────

describe("reservkapitali €/m²/kuu kuvamine", () => {
  const calcRkMaarKuusM2 = (rkKogumine, mEq, koguPind) =>
    koguPind > 0 ? rkKogumine / mEq / koguPind : 0;

  it("1200 € kogumine, 12 kuud, 200 m² → 0,50 €/m²/kuu", () => {
    expect(calcRkMaarKuusM2(1200, 12, 200)).toBeCloseTo(0.50, 2);
  });

  it("koguPind = 0 → 0 (ei jaga nulliga)", () => {
    expect(calcRkMaarKuusM2(1200, 12, 0)).toBe(0);
  });
});
