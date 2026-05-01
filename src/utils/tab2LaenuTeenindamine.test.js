// src/utils/tab2LaenuTeenindamine.test.js
// Lukustab Tab 2 olemasoleva laenu teenindamise loogika:
// - plan.loans on ainus kanoniline allikas (ei looda Laenumakse costRow-sid)
// - computePlan kasutab pohiosPerioodis/intressPerioodis manuaalsete ülekirjutistena
// - topeltarvestust ei teki Laenumakse costRow ja plan.loans kooseksisteerimise korral

import { describe, it, expect, beforeAll } from "vitest";
import { computePlan } from "../engine/computePlan";

const BASE_PLAN = {
  period: { start: "2025-01-01", end: "2025-12-31", year: 2025 },
  building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
  budget: { costRows: [], incomeRows: [] },
  investments: { items: [] },
  funds: { repairFund: { monthlyRateEurPerM2: 0, usageItems: [] }, reserve: { plannedEUR: 0 } },
  loans: [],
  openingBalances: { repairFundEUR: 0, reserveEUR: 0 },
};

// ── 1. plan.loans on kanoniline allikas ──────────────────────────────────────

describe("computePlan: laenu teenindamine plan.loans-ist", () => {
  it("olemasolev laen ilma pohiosPerioodis → amortisatsioonist", () => {
    const plan = {
      ...BASE_PLAN,
      loans: [{
        id: "l1", name: "KredEx laen", principalEUR: 10000, annualRatePct: 3,
        termMonths: 120, type: "annuity", startYM: "2025-01",
        sepiiriostudInvId: null, pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 0,
        allocationBasis: "m2", legalBasisSeadus: true,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items).toHaveLength(1);
    expect(d.loans.servicePeriodEUR).toBeGreaterThan(0);
  });

  it("pohiosPerioodis + intressPerioodis set → override'ib amortisatsiooni", () => {
    const plan = {
      ...BASE_PLAN,
      loans: [{
        id: "l1", name: "Laen", principalEUR: 0, annualRatePct: 0,
        termMonths: 0, type: "annuity", startYM: "2025-01",
        sepiiriostudInvId: null, pohiosPerioodis: 800, intressPerioodis: 200, teenustasudPerioodis: 50,
        allocationBasis: "m2", legalBasisSeadus: true,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items[0].servicingPeriodEUR).toBe(1050);
    expect(d.loans.items[0].principalPeriodEUR).toBe(800);
    expect(d.loans.items[0].interestPeriodEUR).toBe(200);
    expect(d.loans.items[0].feesPeriodEUR).toBe(50);
    expect(d.loans.servicePeriodEUR).toBe(1050);
  });

  it("teenustasudPerioodis arvestatakse servicingPeriodEUR-i", () => {
    const plan = {
      ...BASE_PLAN,
      loans: [{
        id: "l1", name: "Laen", principalEUR: 0, annualRatePct: 0,
        termMonths: 0, type: "annuity", startYM: "2025-01",
        sepiiriostudInvId: null, pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 120,
        allocationBasis: "m2", legalBasisSeadus: true,
      }],
    };
    const d = computePlan(plan);
    expect(d.loans.items[0].feesPeriodEUR).toBe(120);
    expect(d.loans.items[0].servicingPeriodEUR).toBe(120);
  });
});

// ── 2. Topeltarvestuse välistamine ───────────────────────────────────────────

describe("computePlan: Laenumakse costRow ei dubleeri loans.servicePeriodEUR", () => {
  it("Laenumakse costRow mõjutab costPeriodEUR aga mitte loans.servicePeriodEUR", () => {
    const plan = {
      ...BASE_PLAN,
      budget: {
        costRows: [{
          id: "c1", side: "COST", name: "Laenumakse (vana rida)", category: "Laenumakse",
          legal: { bucket: "OPERATIONAL", category: "OTHER", targetedFund: null },
          calc: { type: "FIXED_PERIOD", params: { amountEUR: 500 } },
          summaInput: 500, allocationBasis: "m2",
        }],
        incomeRows: [],
      },
      loans: [{
        id: "l1", name: "Laen", principalEUR: 0, annualRatePct: 0,
        termMonths: 0, type: "annuity", startYM: "2025-01",
        sepiiriostudInvId: null, pohiosPerioodis: 600, intressPerioodis: 0, teenustasudPerioodis: 0,
        allocationBasis: "m2", legalBasisSeadus: true,
      }],
    };
    const d = computePlan(plan);
    // loans.servicePeriodEUR tuleb ainult plan.loans-ist
    expect(d.loans.servicePeriodEUR).toBe(600);
    // costPeriodEUR sisaldab costRow-i (eraldi kanal)
    expect(d.totals.costPeriodEUR).toBe(500);
  });

  it("sepiiriostudInvId-ga laen ei kuulu existingLoans-i", () => {
    const plan = {
      ...BASE_PLAN,
      loans: [
        {
          id: "l1", name: "Planeeritud laen", principalEUR: 10000, annualRatePct: 3,
          termMonths: 120, type: "annuity", startYM: "2025-01",
          sepiiriostudInvId: "inv-xyz", pohiosPerioodis: 0, intressPerioodis: 0, teenustasudPerioodis: 0,
          allocationBasis: "m2", legalBasisSeadus: true,
        },
      ],
    };
    // baseLoans (APPROVED) includes it; APPLIED excludes it
    const dApproved = computePlan(plan, { loanStatus: "APPROVED" });
    const dApplied = computePlan(plan, { loanStatus: "APPLIED" });
    expect(dApproved.loans.servicePeriodEUR).toBeGreaterThan(0);
    expect(dApplied.loans.servicePeriodEUR).toBe(0);
  });
});

// ── 3. Tab 2 UI: andmed ─────────────────────────────────────────────────────

describe("Tab 2 UI: olemasoleva laenu teenindamine", () => {
  let src;
  beforeAll(async () => {
    const fs = await import("fs");
    const path = await import("path");
    src = fs.readFileSync(path.resolve(__dirname, "../MajanduskavaApp.jsx"), "utf-8");
  });

  it("addExistingLoan funktsioon on olemas", () => {
    expect(src).toContain("const addExistingLoan =");
  });

  it("addExistingLoan kasutab mkLoan ilma sepiiriostudInvId-ta (canonical plan.loans)", () => {
    const fnStart = src.indexOf("const addExistingLoan =");
    const fnEnd = src.indexOf("};", fnStart) + 2;
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toContain("mkLoan(");
    expect(fnBody).not.toContain("sepiiriostudInvId");
  });

  it("'+ Lisa olemasolev laen' nupp on Tab 2 laenuplokis", () => {
    const loanBlock = src.slice(
      src.indexOf("Olemasoleva laenu teenindamine"),
      src.indexOf("Kulud kokkuvõte")
    );
    expect(loanBlock).toContain("+ Lisa olemasolev laen");
    expect(loanBlock).toContain("addExistingLoan");
  });

  it("Laenuandja select on laenuplokis", () => {
    const loanBlock = src.slice(
      src.indexOf("Olemasoleva laenu teenindamine"),
      src.indexOf("Kulud kokkuvõte")
    );
    expect(loanBlock).toContain(">Laenuandja<");
    expect(loanBlock).toContain("Swedbank");
    expect(loanBlock).toContain("KredEx / EIS");
  });

  it("Eesmärk select on laenuplokis", () => {
    const loanBlock = src.slice(
      src.indexOf("Olemasoleva laenu teenindamine"),
      src.indexOf("Kulud kokkuvõte")
    );
    expect(loanBlock).toContain(">Eesmärk<");
    expect(loanBlock).toContain("katuse remont");
    expect(loanBlock).toContain("energiatõhususe töö");
  });

  it("perioodi helper tekst eemaldatud laenuplokist", () => {
    const loanBlock = src.slice(
      src.indexOf("Olemasoleva laenu teenindamine"),
      src.indexOf("Kulud kokkuvõte")
    );
    expect(loanBlock).not.toContain("Täidetakse majanduskava perioodi kohta");
  });

  it("'Tehniline jaotusviis' label on laenuplokis", () => {
    const loanBlock = src.slice(
      src.indexOf("Olemasoleva laenu teenindamine"),
      src.indexOf("Kulud kokkuvõte")
    );
    expect(loanBlock).toContain("Tehniline jaotusviis");
    expect(loanBlock).toContain("Kaasomandi osa / m² arvestus");
  });

  it("Laenumakse kuluridu Tab 2 ei loo — + Lisa kulu nupud ei kasuta kategooriat Laenumakse", () => {
    expect(src).not.toMatch(/addRow.*COST.*Laenumakse/);
    expect(src).not.toMatch(/category.*Laenumakse.*addRow/);
  });
});
