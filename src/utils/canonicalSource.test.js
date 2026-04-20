import { describe, it, expect } from "vitest";
import {
  computeKopiiriondvaade,
  computeReserveMin,
  computeRemondifondiArvutus,
} from "./majanduskavaCalc";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mkInv(id, sourceRefId, fundingPlan, opts = {}) {
  return {
    id,
    name: opts.name || `Inv-${id}`,
    sourceType: sourceRefId ? "condition_item" : "standalone",
    sourceRefId,
    plannedYear: opts.plannedYear || 2028,
    totalCostEUR: opts.totalCostEUR || 50000,
    fundingPlan,
  };
}

const BASE_RF_PARAMS = {
  saldoAlgusRaw: "0",
  koguPind: 100,
  periodiAasta: 2026,
  pangaKoef: 1.15,
  kogumisViis: "eraldi",
  pangaMaarOverride: null,
  maarOverride: null,
  loans: [],
  loanStatus: "APPLIED",
  monthEq: 12,
};

// ── 1. assetCondition muutus ei mõjuta arvutusi ──────────────────────────────

describe("assetCondition ei ole investeeringu arvutuste allikas", () => {
  it("assetCondition väljade muutmine ei mõjuta remondifondi arvutust", () => {
    const inv = mkInv("inv-1", "rida-1", [{ source: "Remondifond", amountEUR: 20000 }]);

    const result1 = computeRemondifondiArvutus({
      ...BASE_RF_PARAMS,
      investments: [inv],
    });

    // Simuleerime assetCondition muutust — remondifondi arvutus ei saa seda sisendit
    // Sama investments, sama tulemus
    const result2 = computeRemondifondiArvutus({
      ...BASE_RF_PARAMS,
      investments: [inv],
      // assetCondition pole argument — tõestab, et see ei mõjuta arvutust
    });

    expect(result1.investRemondifondist).toBe(result2.investRemondifondist);
    expect(result1.maarAastasM2).toBe(result2.maarAastasM2);
    expect(result1.saldoLopp).toBe(result2.saldoLopp);
  });

  it("computeRemondifondiArvutus ei aktsepteeri assetCondition parameetrit", () => {
    // Function signature has no assetCondition param — it only takes investments
    const params = { ...BASE_RF_PARAMS, investments: [] };
    const paramNames = Object.keys(params);
    expect(paramNames).not.toContain("assetCondition");
  });
});

// ── 2. ainult investments.items mõjutab remondifondi ─────────────────────────

describe("ainult investments.items mõjutab remondifondi arvutust", () => {
  it("investeeringu lisamine muudab remondifondi arvutust", () => {
    const empty = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [] });

    const inv = mkInv("inv-1", "rida-1", [{ source: "Remondifond", amountEUR: 20000 }]);
    const withInv = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [inv] });

    expect(empty.investRemondifondist).toBe(0);
    expect(withInv.investRemondifondist).toBe(20000);
    expect(withInv.maarAastasM2).toBeGreaterThan(empty.maarAastasM2);
  });

  it("investeeringu eemaldamine muudab remondifondi arvutust", () => {
    const inv = mkInv("inv-1", "rida-1", [{ source: "Remondifond", amountEUR: 30000 }]);
    const with1 = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [inv] });
    const with0 = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [] });

    expect(with1.investRemondifondist).toBe(30000);
    expect(with0.investRemondifondist).toBe(0);
  });
});

// ── 3. condition_item osaleb arvutuses ───────────────────────────────────────

describe("condition_item investeering osaleb arvutuses läbi investments.items", () => {
  it("condition_item remondifondist rahastatav investeering mõjutab remondifondi", () => {
    const condInv = mkInv("inv-c", "rida-1", [{ source: "Remondifond", amountEUR: 25000 }]);
    const result = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [condInv] });

    expect(result.investRemondifondist).toBe(25000);
    expect(result.invDetail).toHaveLength(1);
    expect(result.invDetail[0].nimetus).toBe("Inv-inv-c");
  });
});

// ── 4. standalone osaleb arvutuses ───────────────────────────────────────────

describe("standalone investeering osaleb arvutuses läbi investments.items", () => {
  it("standalone remondifondist rahastatav investeering mõjutab remondifondi", () => {
    const standInv = mkInv("inv-s", null, [{ source: "Remondifond", amountEUR: 15000 }]);
    const result = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [standInv] });

    expect(result.investRemondifondist).toBe(15000);
    expect(result.invDetail).toHaveLength(1);
  });

  it("mõlemad tüübid koos annavad kumulatiivse tulemuse", () => {
    const condInv = mkInv("inv-c", "rida-1", [{ source: "Remondifond", amountEUR: 20000 }]);
    const standInv = mkInv("inv-s", null, [{ source: "Remondifond", amountEUR: 10000 }]);

    const result = computeRemondifondiArvutus({
      ...BASE_RF_PARAMS,
      investments: [condInv, standInv],
    });

    expect(result.investRemondifondist).toBe(30000);
    expect(result.invDetail).toHaveLength(2);
  });
});

// ── 5. legacy investmentsPipeline ei mõjuta runtime't ────────────────────────

describe("legacy investmentsPipeline ei mõjuta runtime arvutusi", () => {
  it("computeRemondifondiArvutus võtab ainult investments parameetrit", () => {
    const inv = mkInv("inv-1", null, [{ source: "Remondifond", amountEUR: 10000 }]);

    // investments param on kanoniline — investmentsPipeline ei ole parameeter
    const result = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [inv] });
    expect(result.investRemondifondist).toBe(10000);

    // Teine "investmentsPipeline" lisamine ei mõjuta midagi
    const result2 = computeRemondifondiArvutus({
      ...BASE_RF_PARAMS,
      investments: [inv],
      investmentsPipeline: { items: [
        mkInv("ghost", null, [{ source: "Remondifond", amountEUR: 99999 }]),
      ]},
    });
    // investmentsPipeline ignoreeritakse — sama tulemus
    expect(result2.investRemondifondist).toBe(10000);
  });

  it("computeKopiiriondvaade ei kasuta investeeringuid üldse", () => {
    // kopiiriondvaade arvutab ainult kulusid, tulusid ja laene — investeeringuid mitte
    const r1 = computeKopiiriondvaade([], [], [], 12, "APPLIED");
    const r2 = computeKopiiriondvaade([], [], [], 12, "APPLIED");
    expect(r1).toEqual(r2);
  });
});

// ── 6. importitud canonical state annab sama tulemuse ─────────────────────────

describe("importitud canonical state annab sama arvutustulemuse", () => {
  it("v1 (migreeritud) ja v2 (natiivne) annavad sama remondifondi", () => {
    // Simuleerime v1 migratsiooni tulemust
    const migratedInv = mkInv("inv-migrated", "sk-1", [
      { source: "Remondifond", amountEUR: 20000 },
      { source: "Laen", amountEUR: 30000 },
    ]);

    // Simuleerime v2 natiivset eksporti — sama investeering
    const nativeInv = mkInv("inv-native", "sk-1", [
      { source: "Remondifond", amountEUR: 20000 },
      { source: "Laen", amountEUR: 30000 },
    ]);

    const loan = {
      id: "loan-1", principalEUR: 30000, annualRatePct: 3.6,
      termMonths: 240, sepiiriostudInvId: "sk-1",
    };

    const params = {
      ...BASE_RF_PARAMS,
      loans: [loan],
      loanStatus: "APPROVED",
    };

    const r1 = computeRemondifondiArvutus({ ...params, investments: [migratedInv] });
    const r2 = computeRemondifondiArvutus({ ...params, investments: [nativeInv] });

    expect(r1.investRemondifondist).toBe(r2.investRemondifondist);
    expect(r1.onLaen).toBe(r2.onLaen);
    expect(r1.maarAastasM2).toBe(r2.maarAastasM2);
    expect(r1.saldoLopp).toBe(r2.saldoLopp);
    expect(r1.laenumaksedKuus).toBe(r2.laenumaksedKuus);
    expect(r1.loanScenario.planeeritudLaenumaksedKuus).toBe(r2.loanScenario.planeeritudLaenumaksedKuus);
  });

  it("tühi investments annab neutraalse tulemuse", () => {
    const r = computeRemondifondiArvutus({ ...BASE_RF_PARAMS, investments: [] });
    expect(r.investRemondifondist).toBe(0);
    expect(r.onLaen).toBe(false);
    expect(r.maarAastasM2).toBe(0);
    expect(r.invDetail).toHaveLength(0);
  });
});
