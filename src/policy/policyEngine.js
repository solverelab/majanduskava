// src/policy/policyEngine.js

const rank = (lvl) => (lvl === "OK" ? 0 : lvl === "WARN" ? 1 : lvl === "ERROR" ? 2 : 9);

export const POLICY_PRESETS = {
  BALANCED: {
    id: "BALANCED",
    name: "Tasakaalustatud",
    hard: {
      requireNonNegativeRepairFund: true,
      requireReserveAtLeastRequired: true,
    },
    limits: {
      loanWarnPerM2: 0.50,
      loanErrorPerM2: 1.00,
      ownersWarnPerM2: 1.50,
      ownersErrorPerM2: 2.50,
    },
  },

  CONSERVATIVE: {
    id: "CONSERVATIVE",
    name: "Konservatiivne",
    hard: {
      requireNonNegativeRepairFund: true,
      requireReserveAtLeastRequired: true,
    },
    limits: {
      loanWarnPerM2: 0.35,
      loanErrorPerM2: 0.75,
      ownersWarnPerM2: 1.25,
      ownersErrorPerM2: 2.00,
    },
  },

  LOAN_FRIENDLY: {
    id: "LOAN_FRIENDLY",
    name: "Laenusõbralik",
    hard: {
      requireNonNegativeRepairFund: true,
      requireReserveAtLeastRequired: true,
    },
    limits: {
      loanWarnPerM2: 0.70,
      loanErrorPerM2: 1.40,
      ownersWarnPerM2: 2.00,
      ownersErrorPerM2: 3.20,
    },
  },
};

export function evaluatePolicy({ derived, policy }) {
  const issues = [];

  const rfClosing = derived?.funds?.repairFundClosingEUR ?? 0;
  const reserveClosing = derived?.funds?.reserveClosingEUR ?? 0;
  const reserveRequired = derived?.funds?.reserveRequiredEUR ?? 0;

  const loanPerM2 = derived?.risks?.loanBurdenEurPerM2 ?? 0;
  const ownersPerM2 = derived?.risks?.ownersNeedEurPerM2 ?? 0;

  // Hard rules
  if (policy.hard.requireNonNegativeRepairFund && rfClosing < 0) {
    issues.push({
      severity: "ERROR",
      code: "POL_RF_NEG",
      section: "Policy",
      message: "Remondifond ei tohi jääda miinusesse (policy reegel).",
    });
  }

  if (policy.hard.requireReserveAtLeastRequired && reserveClosing < reserveRequired) {
    issues.push({
      severity: "ERROR",
      code: "POL_RES_LOW",
      section: "Policy",
      message: "Reservkapital peab olema vähemalt nõutava tasemega (policy reegel).",
    });
  }

  // Soft limits (risks)
  if (loanPerM2 > policy.limits.loanErrorPerM2) {
    issues.push({
      severity: "ERROR",
      code: "POL_LOAN_HIGH",
      section: "Policy",
      message: `Laenukoormus ${loanPerM2} €/m²/kuu ületab kriitilise piiri (${policy.limits.loanErrorPerM2}).`,
    });
  } else if (loanPerM2 > policy.limits.loanWarnPerM2) {
    issues.push({
      severity: "WARN",
      code: "POL_LOAN_WARN",
      section: "Policy",
      message: `Laenukoormus ${loanPerM2} €/m²/kuu on kõrge (piir ${policy.limits.loanWarnPerM2}).`,
    });
  }

  if (ownersPerM2 > policy.limits.ownersErrorPerM2) {
    issues.push({
      severity: "ERROR",
      code: "POL_OWNERS_HIGH",
      section: "Policy",
      message: `Omanike kogukoormus ${ownersPerM2} €/m²/kuu ületab kriitilise piiri (${policy.limits.ownersErrorPerM2}).`,
    });
  } else if (ownersPerM2 > policy.limits.ownersWarnPerM2) {
    issues.push({
      severity: "WARN",
      code: "POL_OWNERS_WARN",
      section: "Policy",
      message: `Omanike kogukoormus ${ownersPerM2} €/m²/kuu on kõrge (piir ${policy.limits.ownersWarnPerM2}).`,
    });
  }

  const hasErrors = issues.some(i => i.severity === "ERROR");
  return { issues, hasErrors };
}