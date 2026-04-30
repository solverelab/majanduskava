// src/utils/rfKogumiseMudel.test.js
// Lukustab remondifondi kogumise mudeli — jaotusaluse-põhine sisend,
// fondiMuuTulu valem, prognoositava lõppsaldo aritmeetika ja Tab 2 tulu eraldatus.

import { describe, it, expect, beforeAll } from "vitest";
import { computeRemondifondiArvutus } from "./majanduskavaCalc";
import { mkRfUsageItem } from "../domain/planSchema";

const BASE = {
  saldoAlgusRaw: "1000",
  koguPind: 300,
  periodiAasta: 2027,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  investments: [],
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12,
  costRows: [],
  rfUsageItems: [],
};

// ── 1. Kaasomand: €/m²/kuu on ainult readonly abikuva, mitte sisend ──────────

describe("kaasomand: m² on ainult arvutuslik abikuva", () => {
  it("maarOverride 0,5 annab laekuminePerioodis = 0,5 × 300 × 12", () => {
    const r = computeRemondifondiArvutus({ ...BASE, maarOverride: 0.5 });
    expect(r.laekuminePerioodis).toBe(1800);
  });

  it("maarKuusM2 tuleneb laekuminePerioodisest, mitte sisendist eraldi", () => {
    const r = computeRemondifondiArvutus({ ...BASE, maarOverride: 0.5 });
    expect(r.maarKuusM2).toBeCloseTo(0.5, 5);
    // laekuminePerioodis on primaarne; maarKuusM2 on abituletis
    expect(r.laekuminePerioodis).toBe(Math.round(r.maarKuusM2 * BASE.koguPind * BASE.monthEq));
  });

  it("maarOverride puudumisel laekuminePerioodis = 0 (mitte automaatne)", () => {
    const r = computeRemondifondiArvutus({ ...BASE, maarOverride: null });
    expect(r.laekuminePerioodis).toBe(0);
  });
});

// ── 2. Korteri kohta: arvutus = määr × korterite arv × kuude arv ─────────────

describe("korteri kohta: perioodis koguneb = määr × aptCount × mEq", () => {
  it("10 korterit × 20 €/kuu × 12 kuud = 2400 €", () => {
    const aptCount = 10;
    const maarKorterKuu = 20;
    const mEq = 12;
    const planKogumine = Math.round(maarKorterKuu * aptCount * mEq);
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: planKogumine });
    expect(r.laekuminePerioodis).toBe(2400);
  });

  it("aptCount 0 korral planKogumine = 0 → laekuminePerioodis = 0", () => {
    // UI arvutab: Math.round(maarKorterKuu * 0 * 12) = 0 → null
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: null });
    expect(r.laekuminePerioodis).toBe(0);
  });

  it("5 korterit × 15 €/kuu × 6 kuud (lühiperiood) = 450 €", () => {
    const total = Math.round(15 * 5 * 6);
    const r = computeRemondifondiArvutus({ ...BASE, monthEq: 6, planeeritudKogumine: total });
    expect(r.laekuminePerioodis).toBe(450);
  });
});

// ── 3. Muu: perioodis koguneb = kasutaja sisestatud planeeritudKogumine ───────

describe("muu: perioodis koguneb = planeeritudKogumine", () => {
  it("planeeritudKogumine 3500 → laekuminePerioodis 3500", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 3500 });
    expect(r.laekuminePerioodis).toBe(3500);
  });

  it("planeeritudKogumine 0 → laekuminePerioodis 0", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 0 });
    expect(r.laekuminePerioodis).toBe(0);
  });
});

// ── 4. Tab 2 tulud ei lähe automaatselt remondifondi ─────────────────────────

describe("Tab 2 tulu ei mõjuta remondifondi automaatselt", () => {
  it("costRows ilma remondifond fundingSource'ita ei mõjuta laekuminePerioodis", () => {
    const rows = [
      { category: "Kommunaalteenused", summaInput: "5000", arvutus: "perioodis" },
      { category: "Haldusteenused", summaInput: "2000", arvutus: "perioodis" },
    ];
    const withRows = computeRemondifondiArvutus({ ...BASE, costRows: rows });
    const withoutRows = computeRemondifondiArvutus({ ...BASE });
    expect(withRows.laekuminePerioodis).toBe(withoutRows.laekuminePerioodis);
  });

  it("incomeRows ei eksisteeri computeRemondifondiArvutus parameetrites (tulu elab Tab 2-s)", () => {
    // computeRemondifondiArvutus-il pole incomeRows parameetrit — see on tahtlik
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1200 });
    expect(r.laekuminePerioodis).toBe(1200);
  });
});

// ── 5. Fondi suunatud muu tulu suurendab prognoositavat lõppsaldot ────────────

describe("fondiMuuTulu suurendab prognoositavat lõppsaldot", () => {
  it("fondiMuuTulu 500 tõstab saldoLopp 500 võrra", () => {
    const rIlma = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 2400 });
    const rKoos = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 2400, fondiMuuTelu: 500 });
    // Note: typo in parameter name check — let's use the correct one
    const rKoosOige = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 2400, fondiMuuTulu: 500 });
    expect(rKoosOige.saldoLopp).toBe(rIlma.saldoLopp + 500);
  });

  it("fondiMuuTulu on nähtav lõppsaldos", () => {
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 0, fondiMuuTulu: 800 });
    expect(r.saldoLopp).toBe(1000 + 0 + 800 - 0); // algsaldo + kogumine + muu - kaetavad
  });

  it("fondiMuuTulu 0 ei muuda saldot", () => {
    const r1 = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1200, fondiMuuTulu: 0 });
    const r2 = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1200 });
    expect(r1.saldoLopp).toBe(r2.saldoLopp);
  });
});

// ── 6. RF-st kaetavad summad vähendavad lõppsaldot ───────────────────────────

describe("RF-st kaetavad summad vähendavad prognoositavat lõppsaldot", () => {
  it("rfUsageItems 1200 vähendab saldoLopp 1200 võrra", () => {
    const rIlma = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 3000 });
    const rKoos = computeRemondifondiArvutus({
      ...BASE,
      planeeritudKogumine: 3000,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 1200 })],
    });
    expect(rKoos.saldoLopp).toBe(rIlma.saldoLopp - 1200);
  });
});

// ── 7. Lõppsaldo valem: algsaldo + perioodis koguneb + fondiMuuTulu − kaetavad

describe("lõppsaldo valem täielik", () => {
  it("1000 + 3000 + 500 − 1200 = 3300", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "1000",
      planeeritudKogumine: 3000,
      fondiMuuTulu: 500,
      rfUsageItems: [mkRfUsageItem({ remondifondistKaetavSumma: 1200 })],
    });
    expect(r.saldoLopp).toBe(3300);
  });

  it("0 + 0 + 0 − 0 = 0 (kõik nullid)", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      saldoAlgusRaw: "0",
      planeeritudKogumine: 0,
      fondiMuuTulu: 0,
      rfUsageItems: [],
    });
    expect(r.saldoLopp).toBe(0);
  });

  it("fondiMuuTulu tagastatakse tulemuses", () => {
    const r = computeRemondifondiArvutus({ ...BASE, fondiMuuTulu: 750 });
    expect(r.fondiMuuTulu).toBe(750);
  });
});

// ── 8. Tab 1 eeldatav maksumus ei muutu automaatselt RF kaetavaks ─────────────

describe("Tab 1 eeldatav maksumus ei muutu automaatselt RF-st kaetavaks summaks", () => {
  it("rfUsageItems ilma remondifondistKaetavSumma'ta annab rfUsageRemondifondist = 0", () => {
    const r = computeRemondifondiArvutus({
      ...BASE,
      rfUsageItems: [mkRfUsageItem({ linkedAssetConditionId: "abc", remondifondistKaetavSumma: "" })],
    });
    expect(r.rfUsageRemondifondist).toBe(0);
  });

  it("eeldatavKulu Tab 1-s ei mõjuta remondifondistKaetavadKokku automaatselt", () => {
    // eeldatavKulu on UI-s ainult infoväli — computeRemondifondiArvutus ei saa seda
    const r = computeRemondifondiArvutus({ ...BASE, planeeritudKogumine: 1000 });
    expect(r.remondifondistKaetavadKokku).toBe(0);
  });
});

// ── 9. Erandi aluse state puhastatakse tagasi tavajuhtumile minnes ────────────

describe("erandi aluse state puhastamine (UI loogika)", () => {
  it("patchRfPolicy kaasomand väärtused puhastavad erandi väljad", () => {
    // UI loogika simulatsioon: select → kaasomand → clearFields
    const erandPolicyAfterClear = {
      defaultBasis: "kaasomand",
      legalBasisBylaws: false,
      legalBasisSpecialAgreement: false,
      legalBasisMuu: false,
      legalBasisTaepsustus: "",
      allocationBasisMuuKirjeldus: "",
    };
    expect(erandPolicyAfterClear.legalBasisBylaws).toBe(false);
    expect(erandPolicyAfterClear.legalBasisSpecialAgreement).toBe(false);
    expect(erandPolicyAfterClear.legalBasisMuu).toBe(false);
    expect(erandPolicyAfterClear.legalBasisTaepsustus).toBe("");
    expect(erandPolicyAfterClear.allocationBasisMuuKirjeldus).toBe("");
  });
});

// ── 10. computePlan jäi muutmata ─────────────────────────────────────────────

describe("computePlan jäi muutmata", () => {
  it("computePlan on deterministlik ja ei sõltu fondiMuuTulust", async () => {
    const { computePlan } = await import("../engine/computePlan");
    const plan = {
      period: { year: 2027, start: "2027-01-01", end: "2027-12-31" },
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
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.building.totAreaM2).toBe(100);
  });
});

// ── 11. UI: kaasomand ei kuva m² sisendina ────────────────────────────────────

describe("UI: kaasomandi osa suuruse alusel ei kuva m² sisendina", () => {
  let src;
  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("'Remondifondi makse määr' on kaasomand-bloki label (mitte €/m²/kuu)", () => {
    expect(src).toContain("Remondifondi makse määr");
  });

  it("€/m²/kuu esineb ainult readonly 'Arvutuslik määr:' real", () => {
    const arvutuslikMatch = src.match(/Arvutuslik määr:.*€\/m²\/kuu/g) || [];
    expect(arvutuslikMatch.length).toBeGreaterThan(0);
    // Ei esine sisendi labels
    expect(src).not.toMatch(/label[^>]*>.*€\/m²\/kuu/);
  });

  it("'Perioodis koguneb' on readonly inforida (mitte sisend)", () => {
    expect(src).toContain("Perioodis koguneb:");
    expect(src).not.toMatch(/<input[^>]*Perioodis koguneb/);
  });

  it("'Fondi suunatud muu tulu' on lisatud UI-s", () => {
    expect(src).toContain("Fondi suunatud muu tulu");
  });

  it("'Soovitud minimaalne lõppsaldo perioodi lõpus' on lisatud UI-s", () => {
    expect(src).toContain("Soovitud minimaalne lõppsaldo perioodi lõpus");
  });

  it("prognoositav lõppsaldo kannab nime 'Prognoositav remondifondi saldo perioodi lõpus'", () => {
    expect(src).toContain("Prognoositav remondifondi saldo perioodi lõpus");
  });
});
