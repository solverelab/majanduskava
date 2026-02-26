// src/policy/policyRuntime.js
import { parse as parseYAML } from "yaml";

export function loadPolicyYaml(yamlText) {
  const doc = parseYAML(yamlText);
  if (!doc || doc.version !== 1 || !doc.presets) {
    throw new Error("Invalid policy YAML (expected version: 1, presets: ...)");
  }
  return doc;
}

export function getPreset(policyDoc, presetId) {
  const preset = policyDoc?.presets?.[presetId];
  if (!preset) throw new Error(`Unknown policy preset: ${presetId}`);
  return preset;
}

// Solvere Action schema (v1)
export function mkAction({ kind, label, patch, computed, confidence = "HIGH", reason }) {
  return { schemaVersion: "action/v1", kind, label, patch, computed, confidence, reason };
}

const roundTo = (x, step) => {
  const s = Number(step || 1);
  if (!s || !isFinite(s)) return x;
  return Math.round(x / s) * s;
};
const safeNum = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

function compileActionsForIssue({ issue, derived, preset, plan }) {
  const remedies = preset?.remedies || [];
  const match = remedies.filter(r => r?.when?.code === issue.code);
  if (!match.length) return [];

  const actions = [];
  for (const r of match) {
    for (const a of (r.actions || [])) {
      const kind = a.kind;
      const label = a.label || kind;
      const params = a.params || {};

      if (kind === "ADJUST_REPAIR_FUND_RATE") {
        const rfShortfall = Math.max(0, -safeNum(derived?.funds?.repairFundClosingEUR, 0));
        const totArea = safeNum(derived?.building?.totAreaM2, 0);
        const monthEq = Math.max(0.001, safeNum(derived?.period?.monthEq, 12));
        const rounding = params.rounding ?? 0.001;

        if (rfShortfall > 0 && totArea > 0) {
          const addRate = rfShortfall / (totArea * monthEq);
          const curRate = safeNum(plan?.funds?.repairFund?.monthlyRateEurPerM2, 0);
          const newRate = roundTo(curRate + addRate, rounding);

          actions.push(mkAction({
            kind, label,
            patch: [
              { op: "set", path: "funds.repairFund.monthlyRateEurPerM2", value: newRate },
            ],
            computed: { rfShortfallEUR: rfShortfall, currentRate: curRate, newRate, addRatePerM2: addRate },
            reason: `Arvutatud nii, et remondifondi lõppjääk ei jääks miinusesse (${rfShortfall.toFixed(2)} € katmine).`,
          }));
        }
      }

      if (kind === "ONE_OFF_PAYMENT") {
        const rfShortfall = Math.max(0, -safeNum(derived?.funds?.repairFundClosingEUR, 0));
        const rounding = params.rounding ?? 1;
        if (rfShortfall > 0) {
          const amount = roundTo(rfShortfall, rounding);
          actions.push(mkAction({
            kind, label,
            patch: [
              { op: "increment", path: "openingBalances.repairFundEUR", value: amount },
            ],
            computed: { amountEUR: amount },
            confidence: "MED",
            reason: "Ühekordne makse katab remondifondi puudujäägi; vajab otsustust (kuidas jaotada korterite vahel).",
          }));
        }
      }

      if (kind === "EXTEND_LOAN_TERM") {
        const stepMonths = Number(params.stepMonths || 12);
        const maxMonths = Number(params.maxMonths || 360);
        const loanWarn = safeNum(preset?.limits?.loanWarnPerM2, 0.5);
        const totArea = safeNum(derived?.building?.totAreaM2, 0);
        const ln = (plan?.loans || [])[0];
        if (ln && totArea > 0) {
          const currentTerm = safeNum(ln.termMonths, 0);
          const currentMonthly = safeNum(derived?.loans?.serviceMonthlyEUR, 0);
          const currentBurden = totArea > 0 ? (currentMonthly / totArea) : 0;

          if (currentBurden > loanWarn && currentTerm > 0) {
            let term = currentTerm;
            let estBurden = currentBurden;
            while (term + stepMonths <= maxMonths && estBurden > loanWarn) {
              term += stepMonths;
              estBurden = currentBurden * (currentTerm / term);
            }
            if (term !== currentTerm) {
              const loanIdx = (plan?.loans || []).findIndex(x => x.id === ln.id);
              actions.push(mkAction({
                kind, label,
                patch: [
                  { op: "set", path: `loans[${loanIdx}].termMonths`, value: term },
                ],
                computed: { loanId: ln.id, loanIdx, currentTerm, proposedTerm: term, estBurdenToPerM2: estBurden, targetWarnPerM2: loanWarn },
                confidence: "MED",
                reason: "Heuristiline soovitus (täpseks arvutuseks saab kasutada amortisatsiooni ajakava).",
              }));
            }
          }
        }
      }

      if (kind === "SHIFT_INVESTMENT") {
        actions.push(mkAction({
          kind, label,
          patch: [],
          computed: { years: Number(params.years || 2) },
          confidence: "LOW",
          reason: "Vajab täpsustamist (milline investeering, milline ajastus ja rahastus).",
        }));
      }
    }
  }
  return actions;
}

function attachRemediesAndActions({ issues, preset, derived, plan }) {
  return issues.map(issue => {
    const actions = compileActionsForIssue({ issue, derived, preset, plan });
    return { ...issue, actions };
  });
}

export function evaluateMajanduskavaPolicy({ derived, preset, plan }) {
  const issues = [];

  const rfClosing = derived?.funds?.repairFundClosingEUR ?? 0;
  const reserveClosing = derived?.funds?.reserveClosingEUR ?? 0;
  const reserveRequired = derived?.funds?.reserveRequiredEUR ?? 0;

  const loanPerM2 = derived?.risks?.loanBurdenEurPerM2 ?? 0;
  const ownersPerM2 = derived?.risks?.ownersNeedEurPerM2 ?? 0;

  const hard = preset?.hard || {};
  const limits = preset?.limits || {};

  // Hard rules
  if (hard.requireNonNegativeRepairFund && rfClosing < 0) {
    issues.push({
      severity: "ERROR",
      code: "POL_RF_NEG",
      section: "Policy",
      message: "Remondifond ei tohi jääda miinusesse (policy reegel).",
      facts: { rfClosing },
      thresholds: { rfClosingMin: 0 },
      marginToThreshold: { rfClosingMin: rfClosing - 0 },
    });
  }

  if (hard.requireReserveAtLeastRequired && reserveClosing < reserveRequired) {
    issues.push({
      severity: "ERROR",
      code: "POL_RES_LOW",
      section: "Policy",
      message: "Reservkapital peab olema vähemalt nõutava tasemega (policy reegel).",
      facts: { reserveClosing, reserveRequired },
      thresholds: { reserveRequiredMin: reserveRequired },
      marginToThreshold: { reserveRequiredMin: reserveClosing - reserveRequired },
    });
  }

  // Soft limits
  if (loanPerM2 > (limits.loanErrorPerM2 ?? Infinity)) {
    issues.push({
      severity: "ERROR",
      code: "POL_LOAN_HIGH",
      section: "Policy",
      message: `Laenukoormus ${loanPerM2} €/m²/kuu ületab kriitilise piiri (${limits.loanErrorPerM2}).`,
      facts: { loanPerM2 },
      thresholds: { loanErrorPerM2: limits.loanErrorPerM2 },
      marginToThreshold: { loanErrorPerM2: (limits.loanErrorPerM2 ?? 0) - loanPerM2 },
    });
  } else if (loanPerM2 > (limits.loanWarnPerM2 ?? Infinity)) {
    issues.push({
      severity: "WARN",
      code: "POL_LOAN_WARN",
      section: "Policy",
      message: `Laenukoormus ${loanPerM2} €/m²/kuu on kõrge (piir ${limits.loanWarnPerM2}).`,
      facts: { loanPerM2 },
      thresholds: { loanWarnPerM2: limits.loanWarnPerM2 },
      marginToThreshold: { loanWarnPerM2: (limits.loanWarnPerM2 ?? 0) - loanPerM2 },
    });
  }

  if (ownersPerM2 > (limits.ownersErrorPerM2 ?? Infinity)) {
    issues.push({
      severity: "ERROR",
      code: "POL_OWNERS_HIGH",
      section: "Policy",
      message: `Omanike kogukoormus ${ownersPerM2} €/m²/kuu ületab kriitilise piiri (${limits.ownersErrorPerM2}).`,
      facts: { ownersPerM2 },
      thresholds: { ownersErrorPerM2: limits.ownersErrorPerM2 },
      marginToThreshold: { ownersErrorPerM2: (limits.ownersErrorPerM2 ?? 0) - ownersPerM2 },
    });
  } else if (ownersPerM2 > (limits.ownersWarnPerM2 ?? Infinity)) {
    issues.push({
      severity: "WARN",
      code: "POL_OWNERS_WARN",
      section: "Policy",
      message: `Omanike kogukoormus ${ownersPerM2} €/m²/kuu on kõrge (piir ${limits.ownersWarnPerM2}).`,
      facts: { ownersPerM2 },
      thresholds: { ownersWarnPerM2: limits.ownersWarnPerM2 },
      marginToThreshold: { ownersWarnPerM2: (limits.ownersWarnPerM2 ?? 0) - ownersPerM2 },
    });
  }

  const issuesWithActions = attachRemediesAndActions({ issues, preset, derived, plan });
  const hasErrors = issuesWithActions.some(i => i.severity === "ERROR");
  const risk = scoreMajanduskavaRisk({ derived, preset });
  return { issues: issuesWithActions, hasErrors, risk };
}
export function scoreMajanduskavaRisk({ derived, preset }) {
  const rfClosing = derived?.funds?.repairFundClosingEUR ?? 0;
  const loanPerM2 = derived?.risks?.loanBurdenEurPerM2;
  const ownersPerM2 = derived?.risks?.ownersNeedEurPerM2;
  if (rfClosing < 0) return { level: "ERROR", score: 0, band: "Kõrge", reason: "Remondifond jääb negatiivseks." };
  if (typeof loanPerM2 !== "number" || typeof ownersPerM2 !== "number") {
    return { level: "PENDING", score: null, band: "—", reason: "Koormuse arvutamiseks puuduvad andmed." };
  }
  const limits = preset?.limits || {};
  const scoring = preset?.scoring || {};
  const wLoan = Number(scoring?.weights?.loan ?? 0.35);
  const wOwn = Number(scoring?.weights?.owners ?? 0.65);
  const loanE = Number(limits.loanErrorPerM2 ?? 1.0);
  const ownE = Number(limits.ownersErrorPerM2 ?? 2.5);
  const loan = Number(loanPerM2 || 0);
  const own = Number(ownersPerM2 || 0);
  if (loan > loanE || own > ownE) {
    return { level: "ERROR", score: 0, band: "Kõrge", reason: "Koormus ületab kriitilise piiri." };
  }
  const loanRatio = loanE > 0 ? Math.min(1, loan / loanE) : 0;
  const ownRatio = ownE > 0 ? Math.min(1, own / ownE) : 0;
  let score = 100 - ((loanRatio * wLoan + ownRatio * wOwn) * 100);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const loanW = Number(limits.loanWarnPerM2 ?? 0.5);
  const ownW = Number(limits.ownersWarnPerM2 ?? 1.5);
  const level = (loan > loanW || own > ownW) ? "WARN" : "OK";
  const lowMin = Number(scoring?.bands?.lowMin ?? 80);
  const mediumMin = Number(scoring?.bands?.mediumMin ?? 55);
  const band = score >= lowMin ? "Madal" : score >= mediumMin ? "Keskmine" : "Kõrge";
  const reason = level === "OK"
    ? "Fond jääb positiivseks ja koormus on piirides."
    : "Fond jääb positiivseks, kuid koormus ületab soovituslikku piiri.";
  return { level, score, band, reason };
}

// Generic PatchOperation[] applier for plan state
export function applyPatch(state, patchOps) {
  if (!Array.isArray(patchOps) || patchOps.length === 0) return state;
  let next = structuredClone(state);
  for (const op of patchOps) {
    const { path, value } = op;
    // Parse path: "funds.repairFund.monthlyRateEurPerM2" or "loans[0].termMonths"
    const segments = [];
    for (const part of path.split(".")) {
      const m = part.match(/^(.+)\[(\d+)\]$/);
      if (m) {
        segments.push(m[1]);
        segments.push(Number(m[2]));
      } else {
        segments.push(part);
      }
    }
    // Navigate to parent
    let obj = next;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (obj[seg] === undefined || obj[seg] === null) {
        obj[seg] = typeof segments[i + 1] === "number" ? [] : {};
      }
      obj = obj[seg];
    }
    const lastKey = segments[segments.length - 1];
    if (op.op === "set") {
      obj[lastKey] = value;
    } else if (op.op === "increment") {
      obj[lastKey] = (Number(obj[lastKey]) || 0) + Number(value);
    } else if (op.op === "decrement") {
      obj[lastKey] = (Number(obj[lastKey]) || 0) - Number(value);
    }
  }
  return next;
}
