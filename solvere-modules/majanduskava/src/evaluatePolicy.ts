// solvere-modules/majanduskava/src/evaluatePolicy.ts

import type { EvaluationV1, FindingV1, PolicyBundleV1, DeterminismDepsV1 } from "../../../packages/solvere-core/src/solvereCoreV1";
import { defaultDeterminismDeps } from "../../../packages/solvere-core/src/solvereCoreV1";
import type { PlanMetrics, PlanState } from "./types";
import type { TraceV1, TraceEventV1 } from "../../../src/policy/trace/traceV1";

const POLICY_WINS = new Set(["RF_NEG", "RES_NEG", "RESERVE_LOW"]);

export function evaluatePolicy(args: {
  state: PlanState;
  metrics: PlanMetrics;
  policy: PolicyBundleV1;
  deps?: DeterminismDepsV1;
}): EvaluationV1 {
  const deps = { ...defaultDeterminismDeps, ...(args.deps ?? {}) };
  const { metrics } = args;
  const findings: FindingV1[] = [];
  const traceEvents: TraceEventV1[] = [];

  const makeFinding = (
    input: Omit<FindingV1, "schemaVersion" | "id" | "createdAt">
  ): FindingV1 => {
    const idInput = [
      input.code, input.severity, input.path ?? "", input.metric ?? "",
      JSON.stringify(input.context ?? {}),
    ].join("|");
    return { schemaVersion: "finding/v1", id: deps.makeId(idInput), createdAt: deps.now(), ...input };
  };

  const dropComputeFinding = (code: string) => {
    const idx = findings.findIndex((f) => f.code === code && f.source === "compute");
    if (idx !== -1) findings.splice(idx, 1);
  };

  // 0) Engine-level controls.issues -> Findings (skip ALL_OK)
  for (const issue of metrics.controls?.issues ?? []) {
    if (issue.code === "ALL_OK") continue;
    findings.push(makeFinding({
      code: issue.code, source: "compute", severity: issue.severity,
      title: issue.code, message: issue.message, path: issue.path, tags: ["engine"],
    }));
  }

  // 1) RF_NEG
  if (metrics.funds.repairFundClosingEUR < 0) {
    dropComputeFinding("RF_NEG");
    findings.push(makeFinding({
      code: "RF_NEG", source: "policy", severity: "error",
      title: "Remondifondi lõppjääk on negatiivne",
      message: "Prognoosi järgi muutub remondifondi lõppjääk negatiivseks.",
      path: "funds.repairFundClosingEUR", metric: "funds.repairFundClosingEUR",
      context: { closingEUR: metrics.funds.repairFundClosingEUR }, tags: ["funds", "liquidity"],
    }));
    traceEvents.push({
      kind: "finding",
      findingCode: "RF_NEG",
      severity: "error",
      rule: { id: "majanduskava.repairFund.negative" },
      evidence: [
        { path: "funds.repairFundClosingEUR", op: "<", expected: 0, actual: metrics.funds.repairFundClosingEUR },
      ],
      metrics: { riskWeight: 30 },
    });
  }

  // 2) RES_NEG
  if (metrics.funds.reserveClosingEUR < 0) {
    dropComputeFinding("RES_NEG");
    findings.push(makeFinding({
      code: "RES_NEG", source: "policy", severity: "error",
      title: "Reservi lõppjääk on negatiivne",
      message: "Prognoosi järgi muutub reservi lõppjääk negatiivseks.",
      path: "funds.reserveClosingEUR", metric: "funds.reserveClosingEUR",
      context: { closingEUR: metrics.funds.reserveClosingEUR }, tags: ["reserve", "liquidity"],
    }));
    traceEvents.push({
      kind: "finding",
      findingCode: "RES_NEG",
      severity: "error",
      rule: { id: "majanduskava.reserve.negative" },
      evidence: [
        { path: "funds.reserveClosingEUR", op: "<", expected: 0, actual: metrics.funds.reserveClosingEUR },
      ],
      metrics: { riskWeight: 25 },
    });
  }

  // 3) RESERVE_LOW
  if (metrics.funds.reservePlannedEUR < metrics.funds.reserveRequiredEUR) {
    dropComputeFinding("RESERVE_LOW");
    findings.push(makeFinding({
      code: "RESERVE_LOW", source: "policy", severity: "warning",
      title: "Reserv on alla miinimumnõude",
      message: "Kavandatud reserv on väiksem kui reservkapitali miinimumnõue.",
      path: "funds.reserve.plannedEUR", metric: "funds.reservePlannedEUR",
      context: {
        plannedEUR: metrics.funds.reservePlannedEUR,
        requiredEUR: metrics.funds.reserveRequiredEUR,
        gapEUR: metrics.funds.reserveRequiredEUR - metrics.funds.reservePlannedEUR,
      },
      tags: ["reserve", "compliance"],
    }));
    traceEvents.push({
      kind: "finding",
      findingCode: "RESERVE_LOW",
      severity: "warn",
      rule: { id: "majanduskava.reserve.low" },
      evidence: [
        { path: "funds.reservePlannedEUR", op: "<", expected: metrics.funds.reserveRequiredEUR, actual: metrics.funds.reservePlannedEUR },
      ],
      metrics: { riskWeight: 10 },
    });
  }

  for (const code of POLICY_WINS) dropComputeFinding(code);

  // ── Risk score ──
  let score = 0;
  for (const f of findings) {
    const ctx = (f.context ?? {}) as Record<string, any>;
    const deficit =
      typeof ctx.closingEUR === "number" ? ctx.closingEUR :
      typeof ctx.gapEUR === "number" ? ctx.gapEUR :
      0;
    score += Math.min(30, Math.abs(deficit) / 100);
  }

  const level = score >= 50 ? "high" : score >= 20 ? "medium" : "low";
  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
  const band = clampedScore >= 50 ? "C" : clampedScore >= 20 ? "B" : "A";
  const risk = { schemaVersion: "risk/v1" as const, score: clampedScore, level, band, reason: `Kaalutud skoor: ${clampedScore}` };

  const hasErrors = (metrics.controls?.hasErrors ?? false) || findings.some((f) => f.severity === "error");

  const trace: TraceV1 = {
    schemaVersion: "trace/v1",
    moduleId: "majanduskava",
    events: traceEvents,
  };

  return { schemaVersion: "evaluation/v1", findings, hasErrors, risk, trace };
}
