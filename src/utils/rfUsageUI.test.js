// src/utils/rfUsageUI.test.js
// Lukustab "Fondist rahastatavad tööd" sektsiooni käitumise —
// nüüd on see Tab 1 seisukorra kirjetest juhitud nimekiri, mitte käsitsi lisatav loend.

import { describe, it, expect, beforeAll } from "vitest";

let src;
let sectionBody;

beforeAll(async () => {
  const fs = await import("fs");
  const path = await import("path");
  src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");

  const start = src.indexOf("Fondist rahastatavad tööd");
  const end = src.indexOf("Fondi suunatud muu tulu");
  sectionBody = start >= 0 && end > start ? src.slice(start, end) : "";
});

// ── 1. Eemaldatud UI elemendid ───────────────────────────────────────────────

describe("Eemaldatud UI elemendid", () => {
  it("'+ Lisa fondist rahastatav töö' nupp on eemaldatud", () => {
    expect(sectionBody).not.toContain("+ Lisa fondist rahastatav töö");
    expect(src).not.toContain("+ Lisa fondist rahastatav töö");
  });

  it("'Vali seisukorra objekt' dropdown on eemaldatud", () => {
    expect(sectionBody).not.toContain("Vali seisukorra objekt");
    expect(src).not.toContain("Vali seisukorra objekt");
  });

  it("addRfUsageItem onClick nuppu ei kutsuta enam otse", () => {
    expect(sectionBody).not.toContain("onClick={addRfUsageItem}");
  });
});

// ── 2. Seisukorra-põhine nimekiri ────────────────────────────────────────────

describe("Seisukorra-põhine nimekiri", () => {
  it("nimekiri itereerib seisukord massiivi (mitte usageItems)", () => {
    expect(sectionBody).toMatch(/seisukord\.map\(s\s*=>/);
  });

  it("iga rea juures otsitakse usageItem linkedAssetConditionId järgi", () => {
    expect(sectionBody).toContain("linkedAssetConditionId === s.id");
  });

  it("tühi seisukord kuvab suunava teksti Tab 1 poole", () => {
    expect(sectionBody).toContain("Plaanitud töid ei ole lisatud");
    expect(sectionBody).toContain("Seisukord ja kavandatavad toimingud");
  });
});

// ── 3. Checkbox loogika ──────────────────────────────────────────────────────

describe("Checkbox loogika", () => {
  it("checkbox kasutab 'Rahastatakse remondifondist' silti", () => {
    expect(sectionBody).toContain("Rahastatakse remondifondist");
  });

  it("checkbox märkimisel luuakse mkRfUsageItem linkedAssetConditionId-ga", () => {
    expect(sectionBody).toContain("mkRfUsageItem({ linkedAssetConditionId: s.id })");
  });

  it("checkbox eemaldamisel kutsutakse removeRfUsageItem usageItem.id-ga", () => {
    expect(sectionBody).toContain("removeRfUsageItem(usageItem.id)");
  });
});

// ── 4. Eelarve ületamise hoiatus ─────────────────────────────────────────────

describe("Eelarve ületamise hoiatus", () => {
  it("isOverBudget tingimus kontrollib itemAmt > eeldatavKulu", () => {
    expect(sectionBody).toContain("itemAmt > eeldatavKulu");
  });

  it("hoiatus näitab eeldatavat maksumust koos euroEE formaadiga", () => {
    expect(sectionBody).toContain("ületab töö eeldatavat maksumust");
    expect(sectionBody).toContain("euroEE(eeldatavKulu)");
  });

  it("isOverBudget on false kui eeldatavKulu on 0 (ei näita valepositiivset hoiatust)", () => {
    expect(sectionBody).toContain("eeldatavKulu > 0 && itemAmt > eeldatavKulu");
  });
});

// ── 5. computePlan: usageItems mõju RF saldole ───────────────────────────────

describe("computePlan: usageItems mõju RF saldole", () => {
  it("kui usageItems on tühi, ei mõjuta see RF lõppsaldot", async () => {
    const { computePlan } = await import("../engine/computePlan");
    const base = {
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "a1", label: "1", areaM2: 100 }] },
      budget: { costRows: [], incomeRows: [] },
      investments: { items: [] },
      funds: {
        repairFund: { monthlyRateEurPerM2: 0.5, usageItems: [] },
        reserve: { plannedEUR: 0 },
      },
      loans: [],
      openingBalances: { repairFundEUR: 1000, reserveEUR: 0 },
      allocationPolicies: {},
    };
    const r = computePlan(base);
    expect(r.funds?.repairFundIncomePeriodEUR).toBeDefined();
    expect(r.funds?.repairFundClosingEUR).toBeDefined();
  });
});
