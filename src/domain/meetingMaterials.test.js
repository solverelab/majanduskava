// src/domain/meetingMaterials.test.js
import { describe, it, expect } from "vitest";
import { buildMeetingMaterials, formatMeetingMaterialsText } from "./meetingMaterials";
import { defaultPlan } from "./planSchema";
import { computePlan } from "../engine/computePlan";

function basePlan() {
  return {
    ...defaultPlan({ year: 2026 }),
    period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
    building: { apartments: [{ id: "A", label: "A", areaM2: 30 }, { id: "B", label: "B", areaM2: 70 }] },
  };
}

describe("buildMeetingMaterials — päevakord ja materjalid plaanist", () => {
  it("tühi plaan (kõik nullid) → ainult põhiline majanduskava punkt + baasmaterjalid", () => {
    const m = buildMeetingMaterials(basePlan());
    expect(m.agenda).toEqual(["Majanduskava kinnitamine (2026-01-01–2026-12-31)"]);
    expect(m.materials).toEqual([
      "Majanduskava eelnõu",
      "Korteriomanike maksete jaotuse ülevaade",
    ]);
    expect(m.approvalNote).toBe(null);
  });

  it("periood puudub, aga aasta olemas → silt kasutab aastat", () => {
    const p = basePlan();
    p.period = { year: 2026, start: "", end: "" };
    const m = buildMeetingMaterials(p);
    expect(m.agenda[0]).toBe("Majanduskava kinnitamine (2026)");
  });

  it("reservkapital plaanis → lisab päevakorrapunkti", () => {
    const p = basePlan();
    p.funds.reserve.plannedEUR = 1200;
    const m = buildMeetingMaterials(p);
    expect(m.agenda).toContain("Reservkapitali makse suuruse kinnitamine");
  });

  it("remondifond kasutuses → lisab päevakorrapunkti", () => {
    const p = basePlan();
    p.funds.repairFund.monthlyRateEurPerM2 = 0.5;
    const m = buildMeetingMaterials(p);
    expect(m.agenda).toContain("Remondifondi makse suuruse kinnitamine");
  });

  it("investeeringud olemas → lisab päevakorrapunkti ja materjali", () => {
    const p = basePlan();
    p.investments = { items: [{ id: "i1", name: "Katus", plannedYear: 2026, totalCostEUR: 50000, fundingPlan: [] }] };
    const m = buildMeetingMaterials(p);
    expect(m.agenda).toContain("Investeeringute / tööde plaani kinnitamine");
    expect(m.materials).toContain("Investeeringute loetelu");
  });

  it("seisukorra kirjed → lisab tööde ülevaate materjali", () => {
    const p = basePlan();
    p.assetCondition = { items: [{ id: "s1", ese: "Katus" }] };
    const m = buildMeetingMaterials(p);
    expect(m.agenda).toContain("Investeeringute / tööde plaani kinnitamine");
    expect(m.materials).toContain("Seisukorra / tööde ülevaade");
  });

  it("laen olemas → lisab laenupunkti ja materjali", () => {
    const p = basePlan();
    p.loans = [{ id: "l1", principalEUR: 50000 }];
    const m = buildMeetingMaterials(p);
    expect(m.agenda).toContain("Laenuga seotud otsuse punkt");
    expect(m.materials).toContain("Laenutingimuste kokkuvõte");
  });

  it("tingimuslik laen (investeeringu fundingPlan-is) → lisab laenupunkti, isegi kui laene ei ole", () => {
    const p = basePlan();
    p.investments = { items: [{ id: "i1", name: "Katus", plannedYear: 2026, totalCostEUR: 50000, fundingPlan: [{ source: "Laen", amountEUR: 30000 }] }] };
    const m = buildMeetingMaterials(p);
    expect(m.agenda).toContain("Laenuga seotud otsuse punkt");
  });

  it("approvalStatus='match' → kinnitatud eelnõu märge", () => {
    const m = buildMeetingMaterials(basePlan(), { approvalStatus: "match" });
    expect(m.approvalNote).toBe("Koosoleku materjalide aluseks on kinnitatud eelnõu");
  });

  it("approvalStatus='mismatch' → hoiatus", () => {
    const m = buildMeetingMaterials(basePlan(), { approvalStatus: "mismatch" });
    expect(m.approvalNote).toBe("Hoiatus: kava on pärast eelnõu kinnitamist muudetud");
  });

  it("formatMeetingMaterialsText sisaldab pealkirju, nummerdatud päevakorda ja täppidega materjale", () => {
    const p = basePlan();
    p.funds.reserve.plannedEUR = 1200;
    const text = formatMeetingMaterialsText(buildMeetingMaterials(p, { approvalStatus: "match" }));
    expect(text).toContain("Koosoleku materjalide aluseks on kinnitatud eelnõu");
    expect(text).toContain("PÄEVAKORD");
    expect(text).toContain("1. Majanduskava kinnitamine");
    expect(text).toContain("2. Reservkapitali makse suuruse kinnitamine");
    expect(text).toContain("MATERJALID");
    expect(text).toContain("• Majanduskava eelnõu");
  });

  it("ei lisa üldiseid/ebakonkreetseid punkte ega 'Muud küsimused' tüüpi teksti", () => {
    const m = buildMeetingMaterials(basePlan());
    const joined = m.agenda.join(" | ").toLowerCase();
    expect(joined).not.toMatch(/muud küsimus/);
    expect(joined).not.toMatch(/arutada muid/);
  });

  it("regressioon: arvutustulemus ei muutu meeting-helperi kasutamisest", () => {
    const p = {
      ...basePlan(),
      period: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
      budget: {
        costRows: [{
          id: "h1", category: "Haldus", summaInput: 1200, arvutus: "aastas",
          legal: { bucket: "OPERATIONAL", category: "MAINTENANCE", targetedFund: null },
          calc: { type: "ANNUAL_FIXED", params: { annualEUR: 1200 } },
        }],
        incomeRows: [],
      },
    };
    const before = computePlan(p);
    // helperi kutsumine ei mõjuta plaani ega arvutust
    buildMeetingMaterials(p);
    formatMeetingMaterialsText(buildMeetingMaterials(p));
    const after = computePlan(p);
    expect(after.apartmentPayments).toEqual(before.apartmentPayments);
    expect(after.totals).toEqual(before.totals);
    expect(after.funds).toEqual(before.funds);
  });
});
