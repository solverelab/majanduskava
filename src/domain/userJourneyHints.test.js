// src/domain/userJourneyHints.test.js
// Mirrors two UX nudges added to MajanduskavaApp.jsx Tab 6:
//   1. Aggregated drift warning near Print button when ANY compliance layer
//      is mismatched.
//   2. Per-state "Järgmine samm" hints under each compliance layer's match
//      status.
//
// Eesmärk: kinnitada kasutajateekonna nähtavuse reeglid puhta funktsiooni
// kujul, ilma React DOM testimist nõudmata.

import { describe, it, expect } from "vitest";
import { buildStateSignature } from "../../packages/solvere-core/src/moduleHost.ts";
import { defaultPlan } from "./planSchema";
import { computePlan } from "../engine/computePlan";

function planSignatureForApproval(p) {
  return buildStateSignature({
    ...p,
    draftApproval: undefined,
    materialsPackage: undefined,
    writtenVotingPackage: undefined,
  });
}

// Mirrors the "drift" decision next to the Print button.
function anyComplianceDrift(p) {
  const sig = planSignatureForApproval(p);
  const da = p.draftApproval || {};
  const mp = p.materialsPackage || {};
  const wvp = p.writtenVotingPackage || {};
  return Boolean(
    (da.isLocked && da.stateSignature !== sig) ||
    (mp.isCreated && mp.stateSignature !== sig) ||
    (wvp.isCreated && wvp.stateSignature !== sig)
  );
}

// Mirrors the "Järgmine samm" hint for each match state.
function nextStepHintAfter(layerKey, p) {
  if (layerKey === "draftApproval") {
    return p.materialsPackage?.isCreated ? null : "Järgmine samm: koosta koosoleku materjalid";
  }
  if (layerKey === "materialsPackage") {
    return p.writtenVotingPackage?.isCreated ? null : "Järgmine samm: prindi või koosta kirjaliku hääletamise pakett";
  }
  if (layerKey === "writtenVotingPackage") {
    return "Järgmine samm: prindi ja jaga materjalid";
  }
  return null;
}

describe("Kasutajateekonna UX — drift-hoiatus ja Järgmine samm vihjed", () => {
  it("ilma fikseerimiseta → drift hoiatust ei kuvata", () => {
    expect(anyComplianceDrift(defaultPlan())).toBe(false);
  });

  it("kui eelnõu on kinnitatud ja kava pole muudetud → drift hoiatust ei kuvata", () => {
    const p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.draftApproval = { isLocked: true, lockedAt: "2026-04-19T10:00:00.000Z", stateSignature: sig };
    expect(anyComplianceDrift(p)).toBe(false);
  });

  it("kui eelnõu signatuur on aegunud → drift hoiatus kuvatakse", () => {
    const p = defaultPlan();
    p.draftApproval = { isLocked: true, lockedAt: "2026-04-19T10:00:00.000Z", stateSignature: "stale" };
    expect(anyComplianceDrift(p)).toBe(true);
  });

  it("kui materjalide pakett on aegunud → drift hoiatus kuvatakse", () => {
    const p = defaultPlan();
    p.materialsPackage = { isCreated: true, createdAt: "2026-04-19T11:00:00.000Z", stateSignature: "stale", items: [] };
    expect(anyComplianceDrift(p)).toBe(true);
  });

  it("kui kirjaliku hääletamise paketi signatuur on aegunud → drift hoiatus kuvatakse", () => {
    const p = defaultPlan();
    p.writtenVotingPackage = { isCreated: true, createdAt: "2026-04-19T12:00:00.000Z", stateSignature: "stale", deadline: "2026-05-01", agendaItems: [], materialItems: [] };
    expect(anyComplianceDrift(p)).toBe(true);
  });

  it("eelnõu match + materjalid pole koostatud → vihje 'koosta koosoleku materjalid'", () => {
    const p = defaultPlan();
    expect(nextStepHintAfter("draftApproval", p)).toBe("Järgmine samm: koosta koosoleku materjalid");
  });

  it("eelnõu match + materjalid juba koostatud → vihje eelnõu all kaob (ei dubleeri)", () => {
    const p = { ...defaultPlan(), materialsPackage: { isCreated: true, createdAt: "x", stateSignature: "x", items: [] } };
    expect(nextStepHintAfter("draftApproval", p)).toBe(null);
  });

  it("materjalid match + kirjalik pakett pole koostatud → vihje 'prindi või koosta kirjaliku hääletamise pakett'", () => {
    const p = defaultPlan();
    expect(nextStepHintAfter("materialsPackage", p)).toBe("Järgmine samm: prindi või koosta kirjaliku hääletamise pakett");
  });

  it("materjalid match + kirjalik pakett koostatud → vihje materjalide all kaob", () => {
    const p = { ...defaultPlan(), writtenVotingPackage: { isCreated: true, createdAt: "x", stateSignature: "x", deadline: "x", agendaItems: [], materialItems: [] } };
    expect(nextStepHintAfter("materialsPackage", p)).toBe(null);
  });

  it("kirjalik pakett match → vihje 'prindi ja jaga materjalid' (lõpp-samm)", () => {
    expect(nextStepHintAfter("writtenVotingPackage", defaultPlan())).toBe("Järgmine samm: prindi ja jaga materjalid");
  });

  it("regressioon: UX vihjed ega drift-hoiatus ei mõjuta computePlan tulemust", () => {
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
    const before = computePlan(JSON.parse(JSON.stringify(base)));
    // Fikseeri kõik kolm kihti
    const sig = planSignatureForApproval(base);
    const after = computePlan({
      ...base,
      draftApproval: { isLocked: true, lockedAt: "x", stateSignature: sig },
      materialsPackage: { isCreated: true, createdAt: "x", stateSignature: sig, items: ["a"] },
      writtenVotingPackage: { isCreated: true, createdAt: "x", stateSignature: sig, deadline: "x", agendaItems: ["a"], materialItems: ["a"] },
    });
    expect(after.apartmentPayments).toEqual(before.apartmentPayments);
    expect(after.totals).toEqual(before.totals);
    expect(after.funds).toEqual(before.funds);
  });
});
