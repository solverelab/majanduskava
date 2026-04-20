// src/domain/writtenVotingPackage.test.js
// Mirrors onCreateWrittenVotingPackage in MajanduskavaApp.jsx as a pure helper
// so the written-voting package metadata + signature semantics can be tested.

import { describe, it, expect } from "vitest";
import { defaultPlan, patchAllocationPolicy } from "./planSchema";
import { buildStateSignature } from "../../packages/solvere-core/src/moduleHost.ts";
import { buildMeetingMaterials, formatWrittenVotingPackageText } from "./meetingMaterials";
import { computePlan } from "../engine/computePlan";

function planSignatureForApproval(p) {
  return buildStateSignature({
    ...p,
    draftApproval: undefined,
    materialsPackage: undefined,
    writtenVotingPackage: undefined,
  });
}

function approvalStatus(p) {
  const da = p.draftApproval || { isLocked: false, stateSignature: null };
  if (!da.isLocked) return "unlocked";
  return da.stateSignature === planSignatureForApproval(p) ? "match" : "mismatch";
}

function createWrittenVotingPackage(p, deadline, nowIso = "2026-04-19T12:00:00.000Z") {
  if (!deadline) return null; // deadline kohustuslik
  const m = buildMeetingMaterials(p, { approvalStatus: approvalStatus(p) });
  return {
    ...p,
    writtenVotingPackage: {
      isCreated: true,
      createdAt: nowIso,
      stateSignature: planSignatureForApproval(p),
      deadline,
      agendaItems: m.agenda,
      materialItems: m.materials,
    },
  };
}

function wvpStatus(p) {
  const wvp = p.writtenVotingPackage || { isCreated: false, stateSignature: null };
  if (!wvp.isCreated) return "not-created";
  return wvp.stateSignature === planSignatureForApproval(p) ? "match" : "mismatch";
}

describe("writtenVotingPackage — kirjaliku hääletamise paketi tõend", () => {
  it("defaultPlan() annab ohutu vaikeseisu", () => {
    const p = defaultPlan();
    expect(p.writtenVotingPackage).toEqual({
      isCreated: false, createdAt: null, stateSignature: null, deadline: null, agendaItems: [], materialItems: [],
    });
  });

  it("vana state (writtenVotingPackage puudub) laeb crashita — wvpStatus='not-created'", () => {
    const old = defaultPlan();
    delete old.writtenVotingPackage;
    expect(() => wvpStatus(old)).not.toThrow();
    expect(wvpStatus(old)).toBe("not-created");
  });

  it("import-migratsioon: puudulik writtenVotingPackage saab ohutu vaikeseisu", () => {
    const cs = { ...defaultPlan() };
    delete cs.writtenVotingPackage;
    if (!cs.writtenVotingPackage || typeof cs.writtenVotingPackage !== "object") {
      cs.writtenVotingPackage = { isCreated: false, createdAt: null, stateSignature: null, deadline: null, agendaItems: [], materialItems: [] };
    }
    expect(cs.writtenVotingPackage.isCreated).toBe(false);
    expect(cs.writtenVotingPackage.agendaItems).toEqual([]);
  });

  it("paketti ei saa luua ilma deadline'ita", () => {
    const res = createWrittenVotingPackage(defaultPlan(), ""); // tühi deadline
    expect(res).toBe(null);
    const res2 = createWrittenVotingPackage(defaultPlan(), null);
    expect(res2).toBe(null);
  });

  it("loomisel salvestatakse signature + timestamp + deadline + agendaItems + materialItems", () => {
    const ready = createWrittenVotingPackage(defaultPlan(), "2026-05-01", "2026-04-19T12:00:00.000Z");
    expect(ready.writtenVotingPackage.isCreated).toBe(true);
    expect(ready.writtenVotingPackage.createdAt).toBe("2026-04-19T12:00:00.000Z");
    expect(ready.writtenVotingPackage.deadline).toBe("2026-05-01");
    expect(typeof ready.writtenVotingPackage.stateSignature).toBe("string");
    expect(ready.writtenVotingPackage.stateSignature.length).toBeGreaterThan(0);
    expect(Array.isArray(ready.writtenVotingPackage.agendaItems)).toBe(true);
    expect(Array.isArray(ready.writtenVotingPackage.materialItems)).toBe(true);
    expect(ready.writtenVotingPackage.agendaItems.length).toBeGreaterThan(0);
    expect(ready.writtenVotingPackage.materialItems.length).toBeGreaterThan(0);
  });

  it("agendaItems / materialItems tulevad helperist, mitte käsitsi", () => {
    const p = { ...defaultPlan() };
    p.loans = [{ id: "l1", principalEUR: 50000 }];
    p.investments = { items: [{ id: "i1", name: "Katus", plannedYear: 2026, totalCostEUR: 10000, fundingPlan: [] }] };
    const ready = createWrittenVotingPackage(p, "2026-05-01");
    const expected = buildMeetingMaterials(p, { approvalStatus: "unlocked" });
    expect(ready.writtenVotingPackage.agendaItems).toEqual(expected.agenda);
    expect(ready.writtenVotingPackage.materialItems).toEqual(expected.materials);
    // Peab sisaldama plaanist tulenevaid elemente
    expect(ready.writtenVotingPackage.agendaItems).toContain("Laenuga seotud otsuse punkt");
    expect(ready.writtenVotingPackage.materialItems).toContain("Investeeringute loetelu");
  });

  it("muutusteta → wvpStatus='match'", () => {
    const ready = createWrittenVotingPackage(defaultPlan(), "2026-05-01");
    expect(wvpStatus(ready)).toBe("match");
  });

  it("plaani muutmisel → wvpStatus='mismatch'", () => {
    let p = createWrittenVotingPackage(defaultPlan(), "2026-05-01");
    p = patchAllocationPolicy(p, "maintenance", { overrideBasis: "korter", legalBasis: "pohikiri" });
    expect(wvpStatus(p)).toBe("mismatch");
  });

  it("draftApproval + materialsPackage + writtenVotingPackage on sõltumatud ja ei sega teineteist", () => {
    let p = defaultPlan();
    // Lukusta eelnõu
    p = {
      ...p,
      draftApproval: { isLocked: true, lockedAt: "2026-04-19T10:00:00.000Z", stateSignature: planSignatureForApproval(p) },
    };
    // Märgi materjalid valmis
    p = {
      ...p,
      materialsPackage: {
        isCreated: true, createdAt: "2026-04-19T11:00:00.000Z",
        stateSignature: planSignatureForApproval(p),
        items: buildMeetingMaterials(p).materials,
      },
    };
    // Koosta kirjaliku hääletamise pakett
    p = createWrittenVotingPackage(p, "2026-05-01", "2026-04-19T12:00:00.000Z");
    // Kõik kolm meta-kihti klapivad sama plaani sisuga
    expect(p.draftApproval.stateSignature).toBe(planSignatureForApproval(p));
    expect(p.materialsPackage.stateSignature).toBe(planSignatureForApproval(p));
    expect(p.writtenVotingPackage.stateSignature).toBe(planSignatureForApproval(p));
    // Üht meta-kihti muutes teised ei purune
    p.materialsPackage = { ...p.materialsPackage, createdAt: "2026-04-20T00:00:00.000Z" };
    expect(p.draftApproval.stateSignature).toBe(planSignatureForApproval(p));
    expect(p.writtenVotingPackage.stateSignature).toBe(planSignatureForApproval(p));
  });

  it("signatuur ei sõltu writtenVotingPackage väljast endast", () => {
    const p = defaultPlan();
    const sigBefore = planSignatureForApproval(p);
    const ready = createWrittenVotingPackage(p, "2026-05-01");
    const sigAfter = planSignatureForApproval(ready);
    expect(sigBefore).toBe(sigAfter);
  });

  it("formatWrittenVotingPackageText sisaldab pealkirja, otsuse eelnõu sissejuhatust, päevakorda, materjale, tähtaega ja kirjaliku vormi märget", () => {
    const text = formatWrittenVotingPackageText({
      periodLabel: "2026-01-01–2026-12-31",
      agendaItems: ["Majanduskava kinnitamine (2026-01-01–2026-12-31)"],
      materialItems: ["Majanduskava eelnõu", "Korteriomanike maksete jaotuse ülevaade"],
      deadline: "2026-05-01",
    });
    expect(text).toContain("KIRJALIKU HÄÄLETAMISE PAKETT");
    expect(text).toContain("Otsuse eelnõu");
    expect(text).toContain("PÄEVAKORD");
    expect(text).toContain("1. Majanduskava kinnitamine");
    expect(text).toContain("MATERJALID");
    expect(text).toContain("• Majanduskava eelnõu");
    expect(text).toContain("Tähtaeg: 2026-05-01");
    expect(text).toContain("kirjalikku taasesitamist võimaldavas vormis");
  });

  it("regressioon: computePlan tulemus ei muutu writtenVotingPackage välja olemasolust", () => {
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
    delete without.writtenVotingPackage;
    const withPkg = createWrittenVotingPackage(JSON.parse(JSON.stringify(base)), "2026-05-01");

    const r1 = computePlan(without);
    const r2 = computePlan(withPkg);
    expect(r2.apartmentPayments).toEqual(r1.apartmentPayments);
    expect(r2.totals).toEqual(r1.totals);
    expect(r2.funds).toEqual(r1.funds);
  });
});
