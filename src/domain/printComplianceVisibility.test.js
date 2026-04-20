// src/domain/printComplianceVisibility.test.js
// Mirrors the print-header compliance meta decision in MajanduskavaApp.jsx.
// Kolme compliance-kihi (draftApproval / materialsPackage / writtenVotingPackage)
// iga kihi rida peab print-vaates tekkima ainult siis, kui see kiht on aktiveeritud,
// ja sõltumatult teistest.

import { describe, it, expect } from "vitest";
import { defaultPlan } from "./planSchema";
import { computePlan } from "../engine/computePlan";

// Mirror of the JSX conditional around MajanduskavaApp.jsx print header
// (search for "Eelnõu kinnitatud" / "Koosoleku materjalid koostatud" /
// "Kirjaliku hääletamise pakett koostatud").
function buildPrintComplianceLines(plan) {
  const lines = [];
  if (plan.draftApproval?.isLocked) {
    lines.push(`Eelnõu kinnitatud: ${plan.draftApproval.lockedAt}`);
    lines.push(`Versioonitõend: ${plan.draftApproval.stateSignature}`);
  }
  if (plan.materialsPackage?.isCreated) {
    lines.push(`Koosoleku materjalid koostatud: ${plan.materialsPackage.createdAt}`);
  }
  if (plan.writtenVotingPackage?.isCreated) {
    lines.push(`Kirjaliku hääletamise pakett koostatud: ${plan.writtenVotingPackage.createdAt} · tähtaeg ${plan.writtenVotingPackage.deadline}`);
  }
  return lines;
}

describe("Print-vaate compliance-meta nähtavus", () => {
  it("ilma aktiveeritud kihtideta → print-meta on tühi", () => {
    expect(buildPrintComplianceLines(defaultPlan())).toEqual([]);
  });

  it("ainult eelnõu kinnitatud → kaks rida (eelnõu + versioonitõend)", () => {
    const p = { ...defaultPlan(), draftApproval: { isLocked: true, lockedAt: "2026-04-19T12:00:00.000Z", stateSignature: "abc" } };
    const lines = buildPrintComplianceLines(p);
    expect(lines).toEqual([
      "Eelnõu kinnitatud: 2026-04-19T12:00:00.000Z",
      "Versioonitõend: abc",
    ]);
  });

  it("ainult koosoleku materjalid koostatud → üks rida", () => {
    const p = { ...defaultPlan(), materialsPackage: { isCreated: true, createdAt: "2026-04-19T13:00:00.000Z", stateSignature: "x", items: [] } };
    const lines = buildPrintComplianceLines(p);
    expect(lines).toEqual(["Koosoleku materjalid koostatud: 2026-04-19T13:00:00.000Z"]);
  });

  it("ainult kirjaliku hääletamise pakett koostatud → üks rida (ka ilma eelnõu lukustuseta)", () => {
    const p = {
      ...defaultPlan(),
      writtenVotingPackage: {
        isCreated: true, createdAt: "2026-04-19T14:00:00.000Z", stateSignature: "y",
        deadline: "2026-05-01", agendaItems: [], materialItems: [],
      },
    };
    const lines = buildPrintComplianceLines(p);
    expect(lines).toEqual([
      "Kirjaliku hääletamise pakett koostatud: 2026-04-19T14:00:00.000Z · tähtaeg 2026-05-01",
    ]);
  });

  it("kõik kolm kihti aktiveeritud → kõik neli rida ilmuvad, õiges järjekorras", () => {
    const p = {
      ...defaultPlan(),
      draftApproval: { isLocked: true, lockedAt: "2026-04-19T10:00:00.000Z", stateSignature: "abc" },
      materialsPackage: { isCreated: true, createdAt: "2026-04-19T11:00:00.000Z", stateSignature: "abc", items: [] },
      writtenVotingPackage: {
        isCreated: true, createdAt: "2026-04-19T12:00:00.000Z", stateSignature: "abc",
        deadline: "2026-05-01", agendaItems: [], materialItems: [],
      },
    };
    const lines = buildPrintComplianceLines(p);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Eelnõu kinnitatud:");
    expect(lines[1]).toContain("Versioonitõend:");
    expect(lines[2]).toContain("Koosoleku materjalid koostatud:");
    expect(lines[3]).toContain("Kirjaliku hääletamise pakett koostatud:");
    expect(lines[3]).toContain("tähtaeg 2026-05-01");
  });

  it("materialsPackage + writtenVotingPackage ilma draftApproval'ita → mõlemad read ilmuvad", () => {
    const p = {
      ...defaultPlan(),
      materialsPackage: { isCreated: true, createdAt: "2026-04-19T11:00:00.000Z", stateSignature: "x", items: [] },
      writtenVotingPackage: {
        isCreated: true, createdAt: "2026-04-19T12:00:00.000Z", stateSignature: "x",
        deadline: "2026-05-01", agendaItems: [], materialItems: [],
      },
    };
    const lines = buildPrintComplianceLines(p);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Koosoleku materjalid koostatud:");
    expect(lines[1]).toContain("Kirjaliku hääletamise pakett koostatud:");
  });

  it("regressioon: compliance-meta read ei mõjuta computePlan tulemust", () => {
    const base = {
      ...defaultPlan({ year: 2026 }),
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "A", areaM2: 30 }, { id: "B", areaM2: 70 }] },
      budget: {
        costRows: [{
          id: "h1", category: "Haldus", summaInput: 1200, arvutus: "aastas",
          legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
          calc: { type: "ANNUAL_FIXED", params: { annualEUR: 1200 } },
        }],
        incomeRows: [],
      },
    };
    const withMeta = {
      ...JSON.parse(JSON.stringify(base)),
      draftApproval: { isLocked: true, lockedAt: "2026-04-19T10:00:00.000Z", stateSignature: "abc" },
      materialsPackage: { isCreated: true, createdAt: "2026-04-19T11:00:00.000Z", stateSignature: "abc", items: ["x"] },
      writtenVotingPackage: {
        isCreated: true, createdAt: "2026-04-19T12:00:00.000Z", stateSignature: "abc",
        deadline: "2026-05-01", agendaItems: ["y"], materialItems: ["z"],
      },
    };
    const r1 = computePlan(JSON.parse(JSON.stringify(base)));
    const r2 = computePlan(withMeta);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
    expect(r2.funds).toEqual(r1.funds);
  });
});
