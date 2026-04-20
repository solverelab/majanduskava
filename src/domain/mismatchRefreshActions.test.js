// src/domain/mismatchRefreshActions.test.js
// Mirrors the Tab 6 UI visibility decisions for re-finalizing actions when
// a compliance layer is in "mismatch" state.

import { describe, it, expect } from "vitest";
import { buildStateSignature } from "../../packages/solvere-core/src/moduleHost.ts";
import { defaultPlan, patchAllocationPolicy } from "./planSchema";
import { computePlan } from "../engine/computePlan";

function planSignatureForApproval(p) {
  return buildStateSignature({
    ...p,
    draftApproval: undefined,
    materialsPackage: undefined,
    writtenVotingPackage: undefined,
  });
}

// Mirrors the JSX rules:
//   first-time button  → !layer.isCreated/isLocked
//   refresh button     → layer.isCreated/isLocked && signature differs
//   match              → layer.isCreated/isLocked && signature equals
function draftApprovalState(p) {
  const da = p.draftApproval || {};
  const sig = planSignatureForApproval(p);
  if (!da.isLocked) return { firstTime: true, refresh: false, match: false };
  if (da.stateSignature === sig) return { firstTime: false, refresh: false, match: true };
  return { firstTime: false, refresh: true, match: false };
}

function materialsState(p) {
  const mp = p.materialsPackage || {};
  const sig = planSignatureForApproval(p);
  if (!mp.isCreated) return { firstTime: true, refresh: false, match: false };
  if (mp.stateSignature === sig) return { firstTime: false, refresh: false, match: true };
  return { firstTime: false, refresh: true, match: false };
}

function writtenVotingState(p) {
  const wvp = p.writtenVotingPackage || {};
  const sig = planSignatureForApproval(p);
  if (!wvp.isCreated) return { firstTime: true, refresh: false, match: false };
  if (wvp.stateSignature === sig) return { firstTime: false, refresh: false, match: true };
  return { firstTime: false, refresh: true, match: false };
}

describe("Mismatch-olekus kuvatakse 'uuesti' tegevus; esmakordne voog säilib", () => {
  it("draftApproval: esmakordne → firstTime=true, refresh=false", () => {
    expect(draftApprovalState(defaultPlan())).toEqual({ firstTime: true, refresh: false, match: false });
  });

  it("draftApproval: match-olek → refresh=false, match=true", () => {
    const p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.draftApproval = { isLocked: true, lockedAt: "x", stateSignature: sig };
    expect(draftApprovalState(p)).toEqual({ firstTime: false, refresh: false, match: true });
  });

  it("draftApproval: mismatch → refresh=true (nupp 'Kinnita uuesti' nähtav)", () => {
    let p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.draftApproval = { isLocked: true, lockedAt: "x", stateSignature: sig };
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(draftApprovalState(p)).toEqual({ firstTime: false, refresh: true, match: false });
  });

  it("materialsPackage: esmakordne → firstTime=true", () => {
    expect(materialsState(defaultPlan())).toEqual({ firstTime: true, refresh: false, match: false });
  });

  it("materialsPackage: mismatch → refresh=true (nupp 'Märgi uuesti valmis' nähtav)", () => {
    let p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.materialsPackage = { isCreated: true, createdAt: "x", stateSignature: sig, items: [] };
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(materialsState(p)).toEqual({ firstTime: false, refresh: true, match: false });
  });

  it("materialsPackage: match → refresh=false", () => {
    const p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.materialsPackage = { isCreated: true, createdAt: "x", stateSignature: sig, items: [] };
    expect(materialsState(p)).toEqual({ firstTime: false, refresh: false, match: true });
  });

  it("writtenVotingPackage: esmakordne → firstTime=true", () => {
    expect(writtenVotingState(defaultPlan())).toEqual({ firstTime: true, refresh: false, match: false });
  });

  it("writtenVotingPackage: mismatch → refresh=true (nupp 'Koosta uuesti' nähtav)", () => {
    let p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.writtenVotingPackage = { isCreated: true, createdAt: "x", stateSignature: sig, deadline: "2026-05-01", agendaItems: [], materialItems: [] };
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(writtenVotingState(p)).toEqual({ firstTime: false, refresh: true, match: false });
  });

  it("writtenVotingPackage: match → refresh=false", () => {
    const p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.writtenVotingPackage = { isCreated: true, createdAt: "x", stateSignature: sig, deadline: "2026-05-01", agendaItems: [], materialItems: [] };
    expect(writtenVotingState(p)).toEqual({ firstTime: false, refresh: false, match: true });
  });

  it("match-olekus ei kuvata 'uuesti' tegevust üheski kihis", () => {
    const p = defaultPlan();
    const sig = planSignatureForApproval(p);
    p.draftApproval = { isLocked: true, lockedAt: "x", stateSignature: sig };
    p.materialsPackage = { isCreated: true, createdAt: "x", stateSignature: sig, items: [] };
    p.writtenVotingPackage = { isCreated: true, createdAt: "x", stateSignature: sig, deadline: "2026-05-01", agendaItems: [], materialItems: [] };
    expect(draftApprovalState(p).refresh).toBe(false);
    expect(materialsState(p).refresh).toBe(false);
    expect(writtenVotingState(p).refresh).toBe(false);
  });

  it("regressioon: computePlan tulemus ei muutu mismatch-refresh tegevuste nähtavusest", () => {
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
    // Simuleeri mismatch-olekut, lugedes plan-i arvutusesse
    const sig = "stale-signature";
    const withMismatch = {
      ...base,
      draftApproval: { isLocked: true, lockedAt: "x", stateSignature: sig },
      materialsPackage: { isCreated: true, createdAt: "x", stateSignature: sig, items: [] },
      writtenVotingPackage: { isCreated: true, createdAt: "x", stateSignature: sig, deadline: "2026-05-01", agendaItems: [], materialItems: [] },
    };
    const after = computePlan(withMismatch);
    expect(after.apartmentPayments).toEqual(before.apartmentPayments);
    expect(after.totals).toEqual(before.totals);
    expect(after.funds).toEqual(before.funds);
  });
});
