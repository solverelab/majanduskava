// solvere-modules/majanduskava/src/policyLoader.ts

import type { PolicyBundleV1 } from "../../../packages/solvere-core/src/solvereCoreV1";

const BALANCED: PolicyBundleV1 = {
  schemaVersion: "policyBundle/v1",
  presetCode: "BALANCED",
  limits: {},
  remedies: {
    RF_NEG: [
      {
        code: "INCREASE_REPAIR_FUND_RATE_SMALL",
        label: "Tõsta remondifondi määra (+0.05 €/m²)",
        strategy: "increase_by",
        amount: 0.05,
        variable: { path: "funds.repairFund.monthlyRateEurPerM2" },
      },
      {
        code: "INCREASE_REPAIR_FUND_RATE_MEDIUM",
        label: "Tõsta remondifondi määra (+0.10 €/m²)",
        strategy: "increase_by",
        amount: 0.1,
        variable: { path: "funds.repairFund.monthlyRateEurPerM2" },
      },
    ],
    RES_NEG: [
      {
        code: "INCREASE_RESERVE_PLANNED_EUR_SMALL",
        label: "Suurenda reservi (+250 €)",
        strategy: "increase_by",
        amount: 250,
        variable: { path: "funds.reserve.plannedEUR" },
      },
      {
        code: "INCREASE_RESERVE_PLANNED_EUR_MEDIUM",
        label: "Suurenda reservi (+500 €)",
        strategy: "increase_by",
        amount: 500,
        variable: { path: "funds.reserve.plannedEUR" },
      },
    ],
    RESERVE_LOW: [
      {
        code: "SET_RESERVE_TO_REQUIRED",
        label: "Sea reserv miinimumnõudele",
        strategy: "set_to",
        value: 0,
        variable: { path: "funds.reserve.plannedEUR" },
        meta: { setToMetric: "funds.reserveRequiredEUR" },
      },
    ],
  },
};

const CONSERVATIVE: PolicyBundleV1 = { ...BALANCED, presetCode: "CONSERVATIVE" };
const LOAN_FRIENDLY: PolicyBundleV1 = { ...BALANCED, presetCode: "LOAN_FRIENDLY" };

export function loadPolicy(presetCode: string): PolicyBundleV1 {
  switch (presetCode) {
    case "BALANCED": return BALANCED;
    case "CONSERVATIVE": return CONSERVATIVE;
    case "LOAN_FRIENDLY": return LOAN_FRIENDLY;
    default: throw new Error(`Unknown policy preset "${presetCode}"`);
  }
}
