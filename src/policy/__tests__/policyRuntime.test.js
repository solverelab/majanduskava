// src/policy/__tests__/policyRuntime.test.js
import { describe, it, expect } from "vitest";
import { loadPolicyYaml, getPreset, evaluateMajanduskavaPolicy, scoreMajanduskavaRisk, applyPatch } from "../policyRuntime";

const YAML_TEXT = `
version: 1
module: majanduskava
presets:
  BALANCED:
    id: BALANCED
    name: Tasakaalustatud
    hard:
      requireNonNegativeRepairFund: true
      requireReserveAtLeastRequired: true
    limits:
      loanWarnPerM2: 0.50
      loanErrorPerM2: 1.00
      ownersWarnPerM2: 1.50
      ownersErrorPerM2: 2.50
`;

describe("policyRuntime (majanduskava)", () => {
  it("loads YAML and preset", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const p = getPreset(doc, "BALANCED");
    expect(p.id).toBe("BALANCED");
    expect(p.limits.loanWarnPerM2).toBeCloseTo(0.5);
  });

  it("RF negative => POL_RF_NEG ERROR", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const preset = getPreset(doc, "BALANCED");

    const derived = {
      funds: { repairFundClosingEUR: -1, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0, ownersNeedEurPerM2: 0 },
    };

    const res = evaluateMajanduskavaPolicy({ derived, preset });
    expect(res.hasErrors).toBe(true);
    expect(res.issues.some(i => i.code === "POL_RF_NEG" && i.severity === "ERROR")).toBe(true);
  });

  it("Reserve below required => POL_RES_LOW ERROR", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const preset = getPreset(doc, "BALANCED");

    const derived = {
      funds: { repairFundClosingEUR: 10, reserveClosingEUR: 40, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0, ownersNeedEurPerM2: 0 },
    };

    const res = evaluateMajanduskavaPolicy({ derived, preset });
    expect(res.hasErrors).toBe(true);
    expect(res.issues.some(i => i.code === "POL_RES_LOW")).toBe(true);
  });

  it("Loan between warn and error => POL_LOAN_WARN", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const preset = getPreset(doc, "BALANCED");

    const derived = {
      funds: { repairFundClosingEUR: 10, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0.78, ownersNeedEurPerM2: 0.90 },
    };

    const res = evaluateMajanduskavaPolicy({ derived, preset });
    expect(res.hasErrors).toBe(false);
    expect(res.issues.some(i => i.code === "POL_LOAN_WARN" && i.severity === "WARN")).toBe(true);
  });

  it("Owners above error => POL_OWNERS_HIGH ERROR", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const preset = getPreset(doc, "BALANCED");

    const derived = {
      funds: { repairFundClosingEUR: 10, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0.2, ownersNeedEurPerM2: 3.0 },
    };

    const res = evaluateMajanduskavaPolicy({ derived, preset });
    expect(res.hasErrors).toBe(true);
    expect(res.issues.some(i => i.code === "POL_OWNERS_HIGH" && i.severity === "ERROR")).toBe(true);
  });

  it("score returns WARN + band for typical loan case", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const preset = getPreset(doc, "BALANCED");
    const derived = {
      funds: { repairFundClosingEUR: 10, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0.78, ownersNeedEurPerM2: 0.90 },
    };
    const r = scoreMajanduskavaRisk({ derived, preset });
    expect(r.level).toBe("WARN");
    expect(typeof r.score).toBe("number");
    expect(["Madal", "Keskmine", "Kõrge"]).toContain(r.band);
  });

  it("score is ERROR when owners above error limit", () => {
    const doc = loadPolicyYaml(YAML_TEXT);
    const preset = getPreset(doc, "BALANCED");
    const derived = {
      funds: { repairFundClosingEUR: 10, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0.2, ownersNeedEurPerM2: 3.0 },
    };
    const r = scoreMajanduskavaRisk({ derived, preset });
    expect(r.level).toBe("ERROR");
    expect(r.score).toBe(0);
    expect(r.band).toBe("Kõrge");
  });

  it("attaches actions to matching issue codes", () => {
    const YAML_WITH_ACTIONS = `
version: 1
module: majanduskava
presets:
  BALANCED:
    id: BALANCED
    name: Tasakaalustatud
    hard:
      requireNonNegativeRepairFund: true
      requireReserveAtLeastRequired: true
    limits:
      loanWarnPerM2: 0.50
      loanErrorPerM2: 1.00
      ownersWarnPerM2: 1.50
      ownersErrorPerM2: 2.50
    remedies:
      - id: RF_FIX
        when: { code: POL_RF_NEG }
        actions:
          - kind: ADJUST_REPAIR_FUND_RATE
            label: "Tõsta remondifondi määra (automaatne)"
            params:
              target: RF_NON_NEGATIVE_CLOSING
              rounding: 0.001
          - kind: ONE_OFF_PAYMENT
            label: "Loo ühekordne makse (kogu summa)"
            params:
              target: RF_SHORTFALL_TOTAL
              rounding: 1
`;
    const doc = loadPolicyYaml(YAML_WITH_ACTIONS);
    const preset = getPreset(doc, "BALANCED");
    const plan = { funds: { repairFund: { monthlyRateEurPerM2: 0.5 } }, loans: [] };
    const derived = {
      period: { monthEq: 12 },
      building: { totAreaM2: 100 },
      funds: { repairFundClosingEUR: -1200, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0, ownersNeedEurPerM2: 0 },
    };
    const res = evaluateMajanduskavaPolicy({ derived, preset, plan });
    const rf = res.issues.find(i => i.code === "POL_RF_NEG");
    expect(rf).toBeTruthy();
    expect(Array.isArray(rf.actions)).toBe(true);
    expect(rf.actions.some(a => a.kind === "ADJUST_REPAIR_FUND_RATE")).toBe(true);
    expect(rf.actions.some(a => a.kind === "ONE_OFF_PAYMENT")).toBe(true);
  });

  it("RF_NEG produces ADJUST_REPAIR_FUND_RATE action with computed values", () => {
    const YAML_WITH_ACTIONS = `
version: 1
module: majanduskava
presets:
  BALANCED:
    id: BALANCED
    name: Tasakaalustatud
    hard:
      requireNonNegativeRepairFund: true
      requireReserveAtLeastRequired: true
    limits:
      loanWarnPerM2: 0.50
      loanErrorPerM2: 1.00
      ownersWarnPerM2: 1.50
      ownersErrorPerM2: 2.50
    remedies:
      - id: RF_FIX
        when: { code: POL_RF_NEG }
        actions:
          - kind: ADJUST_REPAIR_FUND_RATE
            label: "Tõsta remondifondi määra (automaatne)"
            params:
              target: RF_NON_NEGATIVE_CLOSING
              rounding: 0.001
`;
    const doc = loadPolicyYaml(YAML_WITH_ACTIONS);
    const preset = getPreset(doc, "BALANCED");
    const plan = { funds: { repairFund: { monthlyRateEurPerM2: 0.5 } }, loans: [] };
    const derived = {
      period: { monthEq: 12 },
      building: { totAreaM2: 100 },
      funds: { repairFundClosingEUR: -1200, reserveClosingEUR: 100, reserveRequiredEUR: 50 },
      risks: { loanBurdenEurPerM2: 0, ownersNeedEurPerM2: 0 },
    };
    const res = evaluateMajanduskavaPolicy({ derived, preset, plan });
    const rf = res.issues.find(i => i.code === "POL_RF_NEG");
    expect(rf).toBeTruthy();
    const adj = rf.actions.find(a => a.kind === "ADJUST_REPAIR_FUND_RATE");
    expect(adj).toBeTruthy();
    expect(adj.computed.rfShortfallEUR).toBe(1200);
    expect(adj.computed.currentRate).toBe(0.5);
    expect(adj.computed.newRate).toBeGreaterThan(0.5);
    expect(Array.isArray(adj.patch)).toBe(true);
    expect(adj.patch[0].op).toBe("set");
    expect(adj.patch[0].path).toBe("funds.repairFund.monthlyRateEurPerM2");
    expect(adj.patch[0].value).toBeGreaterThan(0.5);
  });
});

describe("applyPatch", () => {
  it("set: sets a nested value", () => {
    const state = { funds: { repairFund: { monthlyRateEurPerM2: 0.5 } } };
    const next = applyPatch(state, [
      { op: "set", path: "funds.repairFund.monthlyRateEurPerM2", value: 1.2 },
    ]);
    expect(next.funds.repairFund.monthlyRateEurPerM2).toBe(1.2);
    expect(state.funds.repairFund.monthlyRateEurPerM2).toBe(0.5); // original unchanged
  });

  it("increment: adds to existing value", () => {
    const state = { openingBalances: { repairFundEUR: 1000 } };
    const next = applyPatch(state, [
      { op: "increment", path: "openingBalances.repairFundEUR", value: 500 },
    ]);
    expect(next.openingBalances.repairFundEUR).toBe(1500);
  });

  it("set with array index: loans[0].termMonths", () => {
    const state = { loans: [{ id: "a", termMonths: 120 }, { id: "b", termMonths: 60 }] };
    const next = applyPatch(state, [
      { op: "set", path: "loans[0].termMonths", value: 180 },
    ]);
    expect(next.loans[0].termMonths).toBe(180);
    expect(next.loans[1].termMonths).toBe(60); // untouched
  });
});