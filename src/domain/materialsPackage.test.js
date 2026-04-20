// src/domain/materialsPackage.test.js
// Mirrors onMarkMaterialsReady in MajanduskavaApp.jsx as a pure helper
// so the materials package metadata + signature semantics can be tested.

import { describe, it, expect } from "vitest";
import { defaultPlan, patchAllocationPolicy } from "./planSchema";
import { buildStateSignature } from "../../packages/solvere-core/src/moduleHost.ts";
import { buildMeetingMaterials } from "./meetingMaterials";
import { computePlan } from "../engine/computePlan";

function planSignatureForApproval(p) {
  return buildStateSignature({ ...p, draftApproval: undefined, materialsPackage: undefined });
}

function approvalStatus(p) {
  const da = p.draftApproval || { isLocked: false, stateSignature: null };
  if (!da.isLocked) return "unlocked";
  return da.stateSignature === planSignatureForApproval(p) ? "match" : "mismatch";
}

function markMaterialsReady(p, nowIso = "2026-04-19T12:00:00.000Z") {
  const items = buildMeetingMaterials(p, { approvalStatus: approvalStatus(p) }).materials;
  return {
    ...p,
    materialsPackage: {
      isCreated: true,
      createdAt: nowIso,
      stateSignature: planSignatureForApproval(p),
      items,
    },
  };
}

function materialsStatus(p) {
  const mp = p.materialsPackage || { isCreated: false, stateSignature: null };
  if (!mp.isCreated) return "not-created";
  return mp.stateSignature === planSignatureForApproval(p) ? "match" : "mismatch";
}

describe("materialsPackage — tutvumispaketi tõend", () => {
  it("defaultPlan() annab ohutu vaikeseisu", () => {
    const p = defaultPlan();
    expect(p.materialsPackage).toEqual({ isCreated: false, createdAt: null, stateSignature: null, items: [] });
  });

  it("vana state (materialsPackage puudub) laeb ilma crashita — materialsStatus='not-created'", () => {
    const old = defaultPlan();
    delete old.materialsPackage;
    expect(() => materialsStatus(old)).not.toThrow();
    expect(materialsStatus(old)).toBe("not-created");
  });

  it("import-migratsioon: puudulik materialsPackage saab ohutu vaikeseisu", () => {
    const cs = { ...defaultPlan() };
    delete cs.materialsPackage;
    if (!cs.materialsPackage || typeof cs.materialsPackage !== "object") {
      cs.materialsPackage = { isCreated: false, createdAt: null, stateSignature: null, items: [] };
    }
    expect(cs.materialsPackage).toEqual({ isCreated: false, createdAt: null, stateSignature: null, items: [] });
  });

  it("'Märgi materjalid valmis' salvestab signature + timestamp + items", () => {
    const p = defaultPlan();
    const ready = markMaterialsReady(p, "2026-04-19T12:00:00.000Z");
    expect(ready.materialsPackage.isCreated).toBe(true);
    expect(ready.materialsPackage.createdAt).toBe("2026-04-19T12:00:00.000Z");
    expect(typeof ready.materialsPackage.stateSignature).toBe("string");
    expect(ready.materialsPackage.stateSignature.length).toBeGreaterThan(0);
    expect(Array.isArray(ready.materialsPackage.items)).toBe(true);
    expect(ready.materialsPackage.items.length).toBeGreaterThan(0);
  });

  it("items tulevad meeting materials helperist, mitte käsitsi", () => {
    const p = { ...defaultPlan() };
    p.loans = [{ id: "l1", principalEUR: 50000 }];
    p.investments = { items: [{ id: "i1", name: "Katus", plannedYear: 2026, totalCostEUR: 10000, fundingPlan: [] }] };
    const ready = markMaterialsReady(p);
    const expected = buildMeetingMaterials(p, { approvalStatus: "unlocked" }).materials;
    expect(ready.materialsPackage.items).toEqual(expected);
    // Peab sisaldama laenu- ja investeeringute materjale, kuna plaanis need on
    expect(ready.materialsPackage.items).toContain("Laenutingimuste kokkuvõte");
    expect(ready.materialsPackage.items).toContain("Investeeringute loetelu");
  });

  it("muutusteta → materialsStatus jääb 'match'", () => {
    const ready = markMaterialsReady(defaultPlan());
    expect(materialsStatus(ready)).toBe("match");
  });

  it("pärast plaani muutmist → materialsStatus='mismatch'", () => {
    let p = defaultPlan();
    p = markMaterialsReady(p);
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(materialsStatus(p)).toBe("mismatch");
  });

  it("draftApproval ja materialsPackage on teineteisest sõltumatud", () => {
    // Lukusta eelnõu ja seejärel märgi materjalid valmis eraldi tegevusena.
    let p = defaultPlan();
    p = {
      ...p,
      draftApproval: { isLocked: true, lockedAt: "2026-04-19T10:00:00.000Z", stateSignature: planSignatureForApproval(p) },
    };
    expect(approvalStatus(p)).toBe("match");
    p = markMaterialsReady(p, "2026-04-19T11:00:00.000Z");
    // Mõlemad kihid peavad nüüd klappima (sama plaani sisu signatuur).
    expect(approvalStatus(p)).toBe("match");
    expect(materialsStatus(p)).toBe("match");
    // Muuda plaani — MÕLEMA kihi staatus peab liikuma mismatch'ile, kuid väärtused jäävad salvestatud kujule.
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(approvalStatus(p)).toBe("mismatch");
    expect(materialsStatus(p)).toBe("mismatch");
    // Salvestatud väärtused endiselt puutumata:
    expect(p.draftApproval.stateSignature).toBeTruthy();
    expect(p.materialsPackage.stateSignature).toBeTruthy();
    // Ja need MITTE ei võrdu omavahel seetõttu, et lukustus ja märkimine toimusid samal plaani sisul — nad VÕRDUVAD.
    expect(p.draftApproval.stateSignature).toBe(p.materialsPackage.stateSignature);
  });

  it("signatuur ei sõltu materialsPackage väljast endast (oma-referents on välistatud)", () => {
    const p = defaultPlan();
    const sigBefore = planSignatureForApproval(p);
    const ready = markMaterialsReady(p);
    const sigAfter = planSignatureForApproval(ready);
    expect(sigBefore).toBe(sigAfter);
  });

  it("regressioon: computePlan tulemus ei muutu materialsPackage välja olemasolust", () => {
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
    const without = JSON.parse(JSON.stringify(base));
    delete without.materialsPackage;
    const withPkg = markMaterialsReady(JSON.parse(JSON.stringify(base)));

    const r1 = computePlan(without);
    const r2 = computePlan(withPkg);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
    expect(r2.funds).toEqual(r1.funds);
  });
});
