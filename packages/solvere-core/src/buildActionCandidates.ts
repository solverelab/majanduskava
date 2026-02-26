/* @solvere/core — buildActionCandidates.ts
 * Builds a top-level actionCandidates[] on EvaluationV1
 * from findings' nested actions, without mutating finding.actions.
 */

import type { ActionCandidateV1, EvaluationV1 } from "./solvereCoreV1";

export function buildActionCandidates(evaluation: EvaluationV1): EvaluationV1 {
  const candidates: ActionCandidateV1[] = [];
  const traceEvents: Array<Record<string, unknown>> = [];

  for (const finding of evaluation.findings) {
    if (!finding.actions?.length) continue;

    for (const action of finding.actions) {
      const riskScoreDelta = action.impact?.riskScoreDelta ?? 0;
      const isEligible = finding.severity !== "info";
      const candidateId = `${finding.id}::${action.code}`;
      const reasons: string[] = isEligible ? ["ELIGIBLE"] : ["NOT_APPLICABLE"];

      candidates.push({
        candidateId,
        findingId: finding.id,
        findingCode: finding.code,
        actionCode: action.code,
        action,
        riskScoreDelta,
        isEligible,
        rank: riskScoreDelta,
      });

      traceEvents.push({
        kind: "actionCandidate",
        candidateId,
        findingCode: finding.code,
        actionCode: action.code,
        riskScoreDelta,
        eligible: isEligible,
        reasons,
        rankVector: {
          primary: riskScoreDelta,
          secondary: action.code,
          tertiary: candidateId,
        },
      });
    }
  }

  // Deterministic ordering: sort trace events by candidateId ASC
  traceEvents.sort((a, b) => {
    const aId = String(a.candidateId ?? "");
    const bId = String(b.candidateId ?? "");
    return aId.localeCompare(bId);
  });

  const existingEvents = evaluation.trace?.events ?? [];

  return {
    ...evaluation,
    actionCandidates: candidates,
    trace: {
      ...(evaluation.trace ?? {}),
      events: [...existingEvents, ...traceEvents],
    },
  };
}
