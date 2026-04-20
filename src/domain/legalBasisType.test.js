// src/domain/legalBasisType.test.js
import { describe, it, expect } from "vitest";
import {
  defaultPlan,
  deriveLegalBasisType,
  getEffectiveAllocationBasis,
  patchAllocationPolicy,
} from "./planSchema";
import { summarizeAllocationPolicy } from "./allocationBasisDisplay";
import { computePlan } from "../engine/computePlan";

describe("legalBasisType / legalBasisText metaväljad", () => {
  it("defaultPlan() annab kõigile kolmele policy-le legalBasisType='DEFAULT_KRTS40_1' ja tühi legalBasisText", () => {
    const plan = defaultPlan();
    for (const key of ["maintenance", "remondifond", "reserve"]) {
      const pol = plan.allocationPolicies[key];
      expect(pol.legalBasisType).toBe("DEFAULT_KRTS40_1");
      expect(pol.legalBasisText).toBe("");
    }
  });

  it("deriveLegalBasisType(): default → DEFAULT_KRTS40_1; override+legalBasis → BYLAWS_EXCEPTION", () => {
    expect(deriveLegalBasisType(undefined)).toBe("DEFAULT_KRTS40_1");
    expect(deriveLegalBasisType({ defaultBasis: "m2", overrideBasis: null, legalBasis: null })).toBe("DEFAULT_KRTS40_1");
    expect(deriveLegalBasisType({ defaultBasis: "m2", overrideBasis: "korter", legalBasis: null })).toBe("DEFAULT_KRTS40_1");
    expect(deriveLegalBasisType({ defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri" })).toBe("BYLAWS_EXCEPTION");
  });

  it("kokkuvõte: legalBasisType=DEFAULT_KRTS40_1 → kuvatakse 'Vaikimisi alus'", () => {
    const pol = defaultPlan().allocationPolicies.maintenance;
    expect(summarizeAllocationPolicy(pol)).toBe("Jaotusalus: m² · Vaikimisi alus");
  });

  it("kokkuvõte: legalBasisType=BYLAWS_EXCEPTION + tühi tekst → 'Erand põhikirja järgi — alus täpsustamata'", () => {
    const pol = {
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "",
      legalBasisType: "BYLAWS_EXCEPTION", legalBasisText: "",
    };
    expect(summarizeAllocationPolicy(pol))
      .toBe("Jaotusalus: korteri kohta · Erand põhikirja järgi — alus täpsustamata");
  });

  it("kokkuvõte: legalBasisType=BYLAWS_EXCEPTION + whitespace-only tekst → 'alus täpsustamata' marker", () => {
    const pol = {
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "",
      legalBasisType: "BYLAWS_EXCEPTION", legalBasisText: "   ",
    };
    expect(summarizeAllocationPolicy(pol))
      .toBe("Jaotusalus: korteri kohta · Erand põhikirja järgi — alus täpsustamata");
  });

  it("kokkuvõte: legalBasisType=BYLAWS_EXCEPTION + legalBasisText → kuvatakse tekst", () => {
    const pol = {
      defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "",
      legalBasisType: "BYLAWS_EXCEPTION", legalBasisText: "Põhikirja p 6.2",
    };
    expect(summarizeAllocationPolicy(pol)).toBe("Jaotusalus: korteri kohta · Põhikirja p 6.2");
  });

  it("vana state (legalBasisType puudub) → crashita; kokkuvõte langeb tagasi varasemale vormingule", () => {
    const oldPol = { defaultBasis: "m2", overrideBasis: null, legalBasis: null, legalBasisNote: "" };
    expect(() => summarizeAllocationPolicy(oldPol)).not.toThrow();
    expect(summarizeAllocationPolicy(oldPol)).toBe("Jaotusalus: m² · Vaikimisi alus");
  });

  it("patchAllocationPolicy säilitab legalBasisType väärtuse, mida pole patchitud", () => {
    let plan = defaultPlan();
    plan = patchAllocationPolicy(plan, "maintenance", { legalBasisText: "Põhikirja p 6.2" });
    expect(plan.allocationPolicies.maintenance.legalBasisType).toBe("DEFAULT_KRTS40_1");
    expect(plan.allocationPolicies.maintenance.legalBasisText).toBe("Põhikirja p 6.2");
  });

  it("regressioon: arvutustulemus ei muutu, kui policy-l on uus meta", () => {
    // Kaks plaani samade sisenditega — üks uue metaga, teine ilma.
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
    const planNew = JSON.parse(JSON.stringify(base));
    const planOld = JSON.parse(JSON.stringify(base));
    // Eemalda legacy plaanist uus meta — simuleerib vana state'i
    for (const k of ["maintenance", "remondifond", "reserve"]) {
      delete planOld.allocationPolicies[k].legalBasisType;
      delete planOld.allocationPolicies[k].legalBasisText;
    }
    const resNew = computePlan(planNew);
    const resOld = computePlan(planOld);
    expect(resNew.apartmentPayments).toEqual(resOld.apartmentPayments);
    expect(resNew.totals).toEqual(resOld.totals);
    expect(resNew.funds).toEqual(resOld.funds);
  });

  it("getEffectiveAllocationBasis ei sõltu legalBasisType väljast (allikaks jääb overrideBasis+legalBasis)", () => {
    // Kui legalBasisType ja tegelik seis ei ühti, siis arvutus peab järgima tegelikku seisu.
    const pol = {
      defaultBasis: "m2", overrideBasis: null, legalBasis: null,
      legalBasisType: "BYLAWS_EXCEPTION", legalBasisText: "",
    };
    expect(getEffectiveAllocationBasis(pol)).toBe("m2");
  });

  it("migratsiooni simulatsioon: vana policy saab legalBasisType/Text fallback'iga", () => {
    const oldPolicy = { defaultBasis: "m2", overrideBasis: "korter", legalBasis: "pohikiri", legalBasisNote: "" };
    const migrated = {
      ...oldPolicy,
      legalBasisType: oldPolicy.legalBasisType ?? deriveLegalBasisType(oldPolicy),
      legalBasisText: oldPolicy.legalBasisText ?? "",
    };
    expect(migrated.legalBasisType).toBe("BYLAWS_EXCEPTION");
    expect(migrated.legalBasisText).toBe("");
  });
});
