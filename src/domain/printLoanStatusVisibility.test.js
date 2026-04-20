// src/domain/printLoanStatusVisibility.test.js
// Mirrors the loan status label decision in the print view loans table
// (MajanduskavaApp.jsx "Fondid ja laen" print-section).
//
// Reegel:
// - laen ilma sepiiriostudInvId-ta → olemasolev laen → "Kinnitatud"
// - laen sepiiriostudInvId-ga (planeeritud, seotud investeeringuga) → kuvatakse
//   globaalse loanStatus järgi: APPROVED → "Kinnitatud", APPLIED → "Taotlusel (tingimuslik)"

import { describe, it, expect } from "vitest";
import { defaultPlan } from "./planSchema";
import { computePlan } from "../engine/computePlan";

function loanStatusLabel(ln, loanStatus) {
  const isPlanned = !!ln.sepiiriostudInvId;
  if (!isPlanned) return "Kinnitatud";
  return loanStatus === "APPROVED" ? "Kinnitatud" : "Taotlusel (tingimuslik)";
}

describe("Print-vaate laenu staatuse silt", () => {
  it("olemasolev laen (ilma sepiiriostudInvId-ta) → 'Kinnitatud' sõltumata globaalsest staatusest", () => {
    const ln = { id: "l1", principalEUR: 50000 };
    expect(loanStatusLabel(ln, "APPLIED")).toBe("Kinnitatud");
    expect(loanStatusLabel(ln, "APPROVED")).toBe("Kinnitatud");
  });

  it("planeeritud laen (seotud investeeringuga) + loanStatus=APPLIED → 'Taotlusel (tingimuslik)'", () => {
    const ln = { id: "l1", principalEUR: 50000, sepiiriostudInvId: "inv-1" };
    expect(loanStatusLabel(ln, "APPLIED")).toBe("Taotlusel (tingimuslik)");
  });

  it("planeeritud laen + loanStatus=APPROVED → 'Kinnitatud'", () => {
    const ln = { id: "l1", principalEUR: 50000, sepiiriostudInvId: "inv-1" };
    expect(loanStatusLabel(ln, "APPROVED")).toBe("Kinnitatud");
  });

  it("regressioon: laenu staatuse silt ei mõjuta computePlan tulemust", () => {
    const base = {
      ...defaultPlan({ year: 2026 }),
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "A", areaM2: 30 }, { id: "B", areaM2: 70 }] },
      loans: [{ id: "l1", name: "Test", principalEUR: 50000, annualRatePct: 5, termMonths: 120, type: "annuity", startYM: "2026-01", reservePct: 10, sepiiriostudInvId: "inv-1" }],
    };
    const r = computePlan(base);
    // laenu tulemus on arvutatud printist sõltumatult
    expect(r.loans.items.length).toBe(1);
    expect(r.loans.servicePeriodEUR).toBeGreaterThan(0);
  });
});
