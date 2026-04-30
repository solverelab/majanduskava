// src/utils/rfAllocationUI.test.js
// Lukustab Tab 5 alapealkiri ja Remondifondi jaotuse UI sõnastuse.

import { describe, it, expect, beforeAll } from "vitest";

let src;
let rfSection;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");

  // Extract the RF allocation UI section (between "Kulude jaotuse alus" and "Laenuga: panga soovituse info")
  const start = src.indexOf("Kulude jaotuse alus");
  const end = src.indexOf("Laenuga: panga soovituse info");
  rfSection = start >= 0 && end > start ? src.slice(Math.max(0, start - 50), end) : "";
});

// ── 1. Tab 5 alapealkiri ──────────────────────────────────────────────────────

describe("Tab 5 alapealkiri", () => {
  it("kuvab 'Jaotamine kaasomandi osa suuruse järgi'", () => {
    expect(src).toContain("Jaotamine kaasomandi osa suuruse järgi");
  });

  it("ei sisalda vana sõnastust 'Jaotamine korteri pindala järgi'", () => {
    expect(src).not.toContain("Jaotamine korteri pindala järgi");
  });
});

// ── 2. Remondifondi jaotuse alus — sektsiooni pealkiri ───────────────────────

describe("Remondifondi jaotuse alus — pealkiri ja helper", () => {
  it("sektsioon kannab silti 'Kulude jaotuse alus'", () => {
    expect(rfSection).toContain("Kulude jaotuse alus");
  });

  it("tavajuhtumi select-valik on 'Kaasomandi osa suuruse alusel'", () => {
    expect(rfSection).toContain("Kaasomandi osa suuruse alusel");
  });

  it("tavajuhtumi helper on 'Kulu jaotatakse KrtS § 40 lg 1 alusel kaasomandi osa suuruse järgi.'", () => {
    expect(rfSection).toContain("Kulu jaotatakse KrtS § 40 lg 1 alusel kaasomandi osa suuruse järgi.");
  });

  it("kuluridadel ei kasutata 'Tehniline jaotusviis' — see label on laenuploki eripärane sõnastus", () => {
    // tab2KuluRida funktsioonis on 'Kulude jaotuse alus', mitte 'Tehniline jaotusviis'
    const kuluridaFn = src.slice(src.indexOf("const tab2KuluRida"), src.indexOf("const existingLoans"));
    expect(kuluridaFn).not.toContain("Tehniline jaotusviis");
    // Laenuplokis on 'Tehniline jaotusviis' ette nähtud (user spec)
    expect(src).toContain("Tehniline jaotusviis");
  });

  it("kuluridadel ei kasutata 'Kaasomandi osa / m²' — kuluridadel on 'Kaasomandi osa suuruse alusel'", () => {
    const kuluridaFn = src.slice(src.indexOf("const tab2KuluRida"), src.indexOf("const existingLoans"));
    expect(kuluridaFn).not.toContain("Kaasomandi osa / m²");
    // Laenuplokis on 'Kaasomandi osa / m² arvestus' ette nähtud (user spec)
    expect(src).toContain("Kaasomandi osa / m² arvestus");
  });

  it("vana sõnastus 'm² järgi' ei esine jaotusaluse UI-s", () => {
    expect(rfSection).not.toContain("m² järgi");
  });

  it("vana 'Korterite suletud netopinna järgi' valik on eemaldatud", () => {
    expect(rfSection).not.toContain("Korterite suletud netopinna järgi");
  });
});

// ── 3. Erandi plokk ──────────────────────────────────────────────────────────

describe("Remondifondi erandi plokk", () => {
  it("sisaldab 'Erandi alus' silti", () => {
    expect(rfSection).toContain("Erandi alus");
  });

  it("'Muu' jaotuse valik toob 'Jaotuse kirjeldus' välja", () => {
    expect(rfSection).toContain("Jaotuse kirjeldus");
  });

  it("erandi plokis ei kuvata 'Seadus' valikut", () => {
    const erandStart = rfSection.indexOf("Erandi alus");
    expect(erandStart).toBeGreaterThan(-1);
    const erandBody = rfSection.slice(erandStart, erandStart + 800);
    expect(erandBody).not.toMatch(/label.*Seadus/s);
    expect(erandBody).not.toContain('"Seadus"');
    expect(erandBody).not.toContain(">Seadus<");
  });

  it("erandi plokis on Põhikiri, Kokkulepe ja Muu valikud", () => {
    const erandStart = rfSection.indexOf("Erandi alus");
    const erandBody = rfSection.slice(erandStart, erandStart + 800);
    expect(erandBody).toContain('"legalBasisBylaws"');
    expect(erandBody).toContain('"legalBasisSpecialAgreement"');
    expect(erandBody).toContain('"legalBasisMuu"');
  });
});

// ── 4. State puhastamine tagasi tavajuhule ────────────────────────────────────

describe("State puhastamine tavajuhule naasmisel", () => {
  it("kaasomand valides puhastatakse legalBasisBylaws, legalBasisSpecialAgreement, legalBasisMuu", () => {
    expect(rfSection).toContain("legalBasisBylaws: false");
    expect(rfSection).toContain("legalBasisSpecialAgreement: false");
    expect(rfSection).toContain("legalBasisMuu: false");
  });

  it("kaasomand valides puhastatakse legalBasisTaepsustus ja allocationBasisMuuKirjeldus", () => {
    expect(rfSection).toContain('legalBasisTaepsustus: ""');
    expect(rfSection).toContain('allocationBasisMuuKirjeldus: ""');
  });
});

// ── 5. computePlan muutumatus ────────────────────────────────────────────────

describe("computePlan muutumatus", () => {
  it("computePlan on olemas ja deterministlik", async () => {
    const { computePlan } = await import("../engine/computePlan");
    const plan = {
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
      budget: { costRows: [], incomeRows: [] },
      investments: { items: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0.5 }, reserve: { plannedEUR: 0 } },
      loans: [],
      openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
      allocationPolicies: {},
    };
    const r1 = computePlan(plan);
    const r2 = computePlan(plan);
    expect(r1.building.totAreaM2).toBe(100);
    expect(r1.period.monthEq).toBe(12);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("allocationPolicies ei mõjuta computePlan tulemust RF makse arvutamisel", async () => {
    const { computePlan } = await import("../engine/computePlan");
    const base = {
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
      budget: { costRows: [], incomeRows: [] },
      investments: { items: [] },
      funds: { repairFund: { monthlyRateEurPerM2: 0.5 }, reserve: { plannedEUR: 0 } },
      loans: [],
      openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
    };
    const r1 = computePlan({ ...base, allocationPolicies: { remondifond: { defaultBasis: "m2" } } });
    const r2 = computePlan({ ...base, allocationPolicies: { remondifond: { defaultBasis: "kaasomand" } } });
    const r3 = computePlan({ ...base, allocationPolicies: { remondifond: { defaultBasis: "apartment" } } });
    expect(r1.funds?.repairFund?.monthlyRateEurPerM2).toBe(r2.funds?.repairFund?.monthlyRateEurPerM2);
    expect(r1.funds?.repairFund?.monthlyRateEurPerM2).toBe(r3.funds?.repairFund?.monthlyRateEurPerM2);
  });
});
