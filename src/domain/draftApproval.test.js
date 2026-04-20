// src/domain/draftApproval.test.js
// Mirrors the approval signature rule in MajanduskavaApp.jsx:
//   planSignatureForApproval(p) = buildStateSignature({ ...p, draftApproval: undefined })
// and the onApproveDraft handler.

import { describe, it, expect } from "vitest";
import { defaultPlan, patchAllocationPolicy } from "./planSchema";
import { buildStateSignature } from "../../packages/solvere-core/src/moduleHost.ts";
import { computePlan } from "../engine/computePlan";

function planSignatureForApproval(p) {
  return buildStateSignature({ ...p, draftApproval: undefined });
}

function approveDraft(p, nowIso = "2026-04-19T12:00:00.000Z") {
  return {
    ...p,
    draftApproval: {
      isLocked: true,
      lockedAt: nowIso,
      stateSignature: planSignatureForApproval(p),
    },
  };
}

// Mirrors the Tab 6 UI derivation
function approvalStatus(p) {
  const da = p.draftApproval || { isLocked: false, lockedAt: null, stateSignature: null };
  if (!da.isLocked) return "unlocked";
  return da.stateSignature === planSignatureForApproval(p) ? "match" : "mismatch";
}

describe("draftApproval — eelnõu lukustamine ja versioonitõend", () => {
  it("defaultPlan() annab ohutu vaikeseisu (isLocked=false, nullid)", () => {
    const p = defaultPlan();
    expect(p.draftApproval).toEqual({ isLocked: false, lockedAt: null, stateSignature: null });
  });

  it("vana state (draftApproval puudub) laeb ilma crashita — approvalStatus tagastab 'unlocked'", () => {
    const oldPlan = defaultPlan();
    delete oldPlan.draftApproval;
    expect(() => approvalStatus(oldPlan)).not.toThrow();
    expect(approvalStatus(oldPlan)).toBe("unlocked");
  });

  it("lukustamine salvestab signature + timestamp", () => {
    const p = defaultPlan();
    const locked = approveDraft(p, "2026-04-19T12:00:00.000Z");
    expect(locked.draftApproval.isLocked).toBe(true);
    expect(locked.draftApproval.lockedAt).toBe("2026-04-19T12:00:00.000Z");
    expect(typeof locked.draftApproval.stateSignature).toBe("string");
    expect(locked.draftApproval.stateSignature.length).toBeGreaterThan(0);
  });

  it("kui midagi ei muutu, siis lock-state jääb 'match'", () => {
    const p = defaultPlan();
    const locked = approveDraft(p);
    expect(approvalStatus(locked)).toBe("match");
  });

  it("kui state muutub pärast lukustamist, kuvatakse 'mismatch'", () => {
    let p = defaultPlan();
    p = approveDraft(p);
    // Kasutaja muudab kava (nt lisab policy erandi)
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(approvalStatus(p)).toBe("mismatch");
  });

  it("signatuur ei sõltu draftApproval väljast endast (oma-referents on välistatud)", () => {
    const p = defaultPlan();
    const sig1 = planSignatureForApproval(p);
    const locked = approveDraft(p, "2026-04-19T12:00:00.000Z");
    const sig2 = planSignatureForApproval(locked);
    // Kuigi draftApproval on muutunud (isLocked, lockedAt, stateSignature),
    // peab ülejäänud plaani signatuur olema sama.
    expect(sig1).toBe(sig2);
  });

  it("regressioon: arvutustulemus ei muutu draftApproval välja olemasolust", () => {
    const base = {
      ...defaultPlan({ year: 2026 }),
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      building: { apartments: [{ id: "A", label: "A", areaM2: 30 }, { id: "B", label: "B", areaM2: 70 }] },
      budget: {
        costRows: [{
          id: "h1", category: "Haldus", summaInput: 1200, arvutus: "aastas",
          legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
          calc: { type: "ANNUAL_FIXED", params: { annualEUR: 1200 } },
        }],
        incomeRows: [],
      },
    };
    const withoutApproval = JSON.parse(JSON.stringify(base));
    delete withoutApproval.draftApproval;
    const withApproval = approveDraft(JSON.parse(JSON.stringify(base)));

    const r1 = computePlan(withoutApproval);
    const r2 = computePlan(withApproval);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
    expect(r2.funds).toEqual(r1.funds);
  });

  it("import fallback: kui draftApproval puudub vanas failis, migratsioon annab ohutu vaikeseisu", () => {
    // Mirror of the import migration block in MajanduskavaApp.jsx
    const candidateState = { ...defaultPlan() };
    delete candidateState.draftApproval;
    if (!candidateState.draftApproval || typeof candidateState.draftApproval !== "object") {
      candidateState.draftApproval = { isLocked: false, lockedAt: null, stateSignature: null };
    }
    expect(candidateState.draftApproval).toEqual({ isLocked: false, lockedAt: null, stateSignature: null });
    expect(approvalStatus(candidateState)).toBe("unlocked");
  });
});
