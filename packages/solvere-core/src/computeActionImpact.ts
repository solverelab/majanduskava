/* @solvere/core — computeActionImpact.ts */

import type { ActionV1, RunResultV1, SolvereModuleHostV1 } from "./solvereCoreV1";

export function withActionImpacts<State, Metrics>(args: {
  host: SolvereModuleHostV1<State, Metrics>;
  base: RunResultV1<State, Metrics>;
}): RunResultV1<State, Metrics> {
  const { host, base } = args;
  const baseScore = base.evaluation.risk?.score ?? 0;

  const findings = base.evaluation.findings.map((f) => {
    if (!f.actions?.length) return f;

    const actions = f.actions.map((a) => {
      // Simulate: apply action and re-run to get new risk score
      const after = host.applyActionAndRun(base.state, a);
      const afterScore = after.evaluation.risk?.score ?? 0;
      const delta = afterScore - baseScore;

      return {
        ...a,
        impact: {
          ...(a.impact ?? {}),
          riskScoreDelta: delta,
          summary: delta < 0 ? `Risk ${delta}` : delta > 0 ? `Risk +${delta}` : "Risk 0",
        },
      } as ActionV1;
    });

    return { ...f, actions };
  });

  return {
    ...base,
    evaluation: {
      ...base.evaluation,
      findings,
    },
  };
}
