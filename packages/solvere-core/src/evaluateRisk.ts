/* @solvere/core — evaluateRisk.ts */

import type { EvaluationV1, RiskV1, FindingV1 } from "./solvereCoreV1";

type PresetCode = "BALANCED" | "CONSERVATIVE" | "LOAN_FRIENDLY";

const PRESET_WEIGHTS: Record<PresetCode, { error: number; warning: number; info: number }> = {
  BALANCED: { error: 30, warning: 12, info: 3 },
  CONSERVATIVE: { error: 35, warning: 15, info: 4 },
  LOAN_FRIENDLY: { error: 25, warning: 9, info: 2 },
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function band(score: number) {
  if (score < 20) return { level: "low" as const, band: "A" };
  if (score < 50) return { level: "medium" as const, band: "B" };
  return { level: "high" as const, band: "C" };
}

function findingWeight(f: FindingV1, weights: { error: number; warning: number; info: number }) {
  if (f.severity === "error") return weights.error;
  if (f.severity === "warning") return weights.warning;
  return weights.info;
}

export function evaluateRiskV1(args: {
  evaluation: EvaluationV1;
  preset: PresetCode;
}): RiskV1 {
  const weights = PRESET_WEIGHTS[args.preset] ?? PRESET_WEIGHTS.BALANCED;

  // Score = sum(weights by severity), capped to 100
  let score = 0;
  for (const f of args.evaluation.findings) score += findingWeight(f, weights);
  score = clamp(score, 0, 100);

  const { level, band: bandCode } = band(score);

  // Reason: top 2 contributors
  const top = [...args.evaluation.findings]
    .map((f) => ({ f, w: findingWeight(f, weights) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 2)
    .map(({ f }) => `${f.code}: ${f.title}`);

  return {
    schemaVersion: "risk/v1",
    level,
    score,
    band: bandCode,
    reason: top.join(" | "),
  };
}
