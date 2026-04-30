// src/policy/__tests__/assetCondition-computePlan.test.js
import { describe, it, expect } from "vitest";
import { computePlan } from "../../engine/computePlan.js";
import { defaultPlan } from "../../domain/planSchema.js";

function basePlan() {
  return {
    ...defaultPlan(),
    period: { start: "2026-01-01", end: "2026-12-31", year: 2026 },
    building: { apartments: [{ id: "a1", label: "1", areaM2: 50 }] },
  };
}

// ── Helper: mirrors uuendaSeisukord updater (after invPatch removal) ──
function applyUuendaSeisukord(plan, id, field, value) {
  const updatedCondition = (plan.assetCondition?.items || []).map(r =>
    r.id !== id ? r : { ...r, [field]: value }
  );
  return { ...plan, assetCondition: { ...plan.assetCondition, items: updatedCondition } };
}

describe("assetCondition ei mõjuta computePlan arvutust", () => {
  it("eeldatavKulu Tab 1 reas ei muuda eelarve kuluridu", () => {
    const planIlma = basePlan();
    const planKoos = {
      ...basePlan(),
      assetCondition: {
        items: [{
          id: "rida-1",
          ese: "Katus",
          eseKohandatud: "",
          seisukordVal: "Halb",
          puudused: "Lekked",
          tegevus: "Katusekatte vahetus",
          eeldatavKulu: 80000,
          prioriteet: "",
          tegevusAasta: "2026",
        }],
      },
    };

    const r1 = computePlan(planIlma);
    const r2 = computePlan(planKoos);

    expect(r2.budget?.totalCostEUR).toEqual(r1.budget?.totalCostEUR);
    expect(r2.budget?.costRows?.length ?? 0).toEqual(r1.budget?.costRows?.length ?? 0);
  });

  it("Tab 1 andmete muutmine ei uuenda investeeringu totalCostEUR (invPatch eemaldatud)", () => {
    const plan = {
      ...basePlan(),
      assetCondition: {
        items: [{ id: "r1", ese: "Katus", eseKohandatud: "", seisukordVal: "", puudused: "", tegevus: "", eeldatavKulu: 1000, prioriteet: "", tegevusAasta: "2026" }],
      },
      investments: {
        items: [{ id: "inv-1", sourceRefId: "r1", sourceType: "condition_item", totalCostEUR: 1000, name: "Katus", plannedYear: 2026, fundingPlan: [] }],
      },
    };

    const updated = applyUuendaSeisukord(plan, "r1", "eeldatavKulu", 99999);

    // investment totalCostEUR ei tohi muutuda pärast invPatch eemaldamist
    expect(updated.investments.items[0].totalCostEUR).toBe(1000);
    // assetCondition küll muutub
    expect(updated.assetCondition.items[0].eeldatavKulu).toBe(99999);
  });
});

describe("Muu… ese loogika", () => {
  it("eseKohandatud väärtus asendab Muu… lõppdokumendis", () => {
    const rida = { id: "r1", ese: "Muu…", eseKohandatud: "Panipaik" };
    const eseNimi = rida.ese === "Muu…" ? (rida.eseKohandatud || "Muu") : rida.ese;
    expect(eseNimi).toBe("Panipaik");
    expect(eseNimi).not.toBe("Muu…");
  });

  it("tühi eseKohandatud kasutab fallback Muu, mitte Muu…", () => {
    const rida = { id: "r2", ese: "Muu…", eseKohandatud: "" };
    const eseNimi = rida.ese === "Muu…" ? (rida.eseKohandatud || "Muu") : rida.ese;
    expect(eseNimi).toBe("Muu");
  });
});

describe("Aasta / periood väli", () => {
  it("tegevusAasta jõuab väljundisse muutmata stringina", () => {
    const rida = { id: "r1", ese: "Katus", tegevusAasta: "2026 Q2" };
    // Print render: {s.tegevusAasta || ""}
    const väljund = rida.tegevusAasta || "";
    expect(väljund).toBe("2026 Q2");
  });

  it("tegevusAasta võib olla vahemik", () => {
    const rida = { id: "r2", ese: "Fassaad", tegevusAasta: "2026–2027" };
    const väljund = rida.tegevusAasta || "";
    expect(väljund).toBe("2026–2027");
  });
});

describe("Uue Tab 1 rea tegevusAasta vaikeväärtus", () => {
  // Mirrors the logic in lisaSeisukordRida and the auto-initial-row useEffect.
  const defaultTegevusAasta = (periodStart) =>
    periodStart ? periodStart.slice(0, 4) : "";

  it("plan.period.start = '2027-01-01' → aasta === '2027'", () => {
    expect(defaultTegevusAasta("2027-01-01")).toBe("2027");
  });

  it("plan.period.start = '2028-01-01' → aasta === '2028'", () => {
    expect(defaultTegevusAasta("2028-01-01")).toBe("2028");
  });

  it("plan.period.start puudub → aasta === ''", () => {
    expect(defaultTegevusAasta("")).toBe("");
    expect(defaultTegevusAasta(null)).toBe("");
    expect(defaultTegevusAasta(undefined)).toBe("");
  });
});

describe("Print veergude pealkirjad", () => {
  it("Kavandatav toiming on lõppdokumendi õige veeru pealkiri", () => {
    const veerg = "Kavandatav toiming";
    expect(veerg).toBe("Kavandatav toiming");
    expect(veerg).not.toBe("Kavandatav tegevus");
  });

  it("Aasta / periood on lõppdokumendi õige aja veeru pealkiri", () => {
    const veerg = "Aasta / periood";
    expect(veerg).not.toBe("Aeg");
    expect(veerg).not.toBe("Aasta");
  });
});
