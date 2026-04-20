// src/policy/__tests__/importLoanFallbackYear.test.js
// Lukustab laenude import-migratsiooni fallback-aasta allika järjekorra:
//   1) candidateState.period?.year  (imporditava faili periood)
//   2) plan.period.year              (aktiivne plaan)
//   3) new Date().getFullYear()     (süsteemiaasta)
//
// Mirrors migration branch in MajanduskavaApp.jsx onImportJSON ("Migrate loan → algusAasta").

import { describe, it, expect } from "vitest";

function migrateLoans(candidateState, plan) {
  if (!candidateState.loans) return candidateState;
  const fallbackY = String(candidateState.period?.year || plan.period.year || new Date().getFullYear());
  candidateState.loans = candidateState.loans.map(ln => {
    const base = { sepiiriostudInvId: ln.sepiiriostudInvId || null };
    if (ln.algusAasta) return { ...ln, ...base, liik: ln.liik || "Remondilaen" };
    if (ln.algus) {
      const ap = ln.algus.split(".");
      return { ...ln, ...base, algusAasta: ap[1] || fallbackY, liik: ln.liik || "Remondilaen" };
    }
    const parts = (ln.startYM || "").split("-");
    return { ...ln, ...base, algusAasta: parts[0] || fallbackY, liik: ln.liik || "Remondilaen" };
  });
  return candidateState;
}

describe("Import migratsioon: laenu algusaasta fallback allikas", () => {
  it("eelistab candidateState.period.year-i aktiivse plaani aasta ees", () => {
    const candidate = {
      period: { year: 2022 },
      loans: [{ id: "l1", algus: "", startYM: "" }],
    };
    const active = { period: { year: 2099 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe("2022");
  });

  it("langeb tagasi aktiivse plaani aastale, kui candidateState.period puudub", () => {
    const candidate = {
      loans: [{ id: "l1", algus: "", startYM: "" }],
    };
    const active = { period: { year: 2030 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe("2030");
  });

  it("langeb tagasi aktiivse plaani aastale, kui candidateState.period.year on falsy (0/null/undefined)", () => {
    const candidate = { period: { year: 0 }, loans: [{ id: "l1", algus: "", startYM: "" }] };
    const active = { period: { year: 2030 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe("2030");
  });

  it("langeb tagasi süsteemiaastale ainult siis, kui mõlemad perioodid puuduvad", () => {
    const candidate = { loans: [{ id: "l1", algus: "", startYM: "" }] };
    const active = { period: { year: 0 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe(String(new Date().getFullYear()));
  });

  it("KK.AAAA formaat: kasutab algus-välja aastat, kui see on olemas — fallback'i ei puudutata", () => {
    const candidate = {
      period: { year: 2022 },
      loans: [{ id: "l1", algus: "03.2025", startYM: "" }],
    };
    const active = { period: { year: 2099 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe("2025");
  });

  it("startYM 'AAAA-KK' formaat: kasutab aastat otse, kui on olemas", () => {
    const candidate = {
      period: { year: 2022 },
      loans: [{ id: "l1", algusAasta: undefined, algus: "", startYM: "2024-06" }],
    };
    const active = { period: { year: 2099 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe("2024");
  });

  it("algusAasta juba seatud → migratsioon ei kirjuta üle, liigi-fallback lisandub", () => {
    const candidate = {
      period: { year: 2022 },
      loans: [{ id: "l1", algusAasta: "2018", algus: "", startYM: "" }],
    };
    const active = { period: { year: 2099 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].algusAasta).toBe("2018");
    expect(out.loans[0].liik).toBe("Remondilaen");
  });

  it("sepiiriostudInvId säilib ja liik vaikeseis lisandub (muu migratsioonikäitumine puutumata)", () => {
    const candidate = {
      period: { year: 2022 },
      loans: [{ id: "l1", sepiiriostudInvId: "inv-7", algus: "", startYM: "" }],
    };
    const active = { period: { year: 2099 } };
    const out = migrateLoans(candidate, active);
    expect(out.loans[0].sepiiriostudInvId).toBe("inv-7");
    expect(out.loans[0].liik).toBe("Remondilaen");
    expect(out.loans[0].algusAasta).toBe("2022");
  });
});
