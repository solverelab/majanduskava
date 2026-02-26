import type { ActionV1, RunResultV1, SolvereModuleHostV1 } from "./solvereCoreV1";

type Options = {
  maxPerFinding?: number;
  maxTotal?: number;
};

export function withActionImpacts<State, Metrics>(args: {
  host: SolvereModuleHostV1<State, Metrics>;
  base: RunResultV1<State, Metrics>;
  options?: Options;
}): RunResultV1<State, Metrics> {
  const { host, base } = args;

  const maxPerFinding = args.options?.maxPerFinding ?? 3;
  const maxTotal = args.options?.maxTotal ?? 12;

  const baseScore = base.evaluation.risk?.score ?? 0;

  const deltaCache = new Map<string, number>();
  let simulations = 0;

  const findings = base.evaluation.findings.map((f) => {
    const actions0 = f.actions ?? [];
    if (!actions0.length) return f;

    const actions = actions0.map((a, idx) => {
      const shouldSimulate = idx < maxPerFinding && simulations < maxTotal;

      if (!shouldSimulate) return a;

      const cached = deltaCache.get(a.id);
      if (cached !== undefined) {
        return {
          ...a,
          impact: {
            ...(a.impact ?? {}),
            riskScoreDelta: cached,
            summary:
              cached < 0 ? `Risk ${cached}` :
              cached > 0 ? `Risk +${cached}` :
              "Risk 0",
          },
        };
      }

      simulations++;

      const after = host.applyActionAndRun(base.state, a);
      const afterScore = after.evaluation.risk?.score ?? 0;
      const delta = afterScore - baseScore;

      deltaCache.set(a.id, delta);

      return {
        ...a,
        impact: {
          ...(a.impact ?? {}),
          riskScoreDelta: delta,
          summary:
            delta < 0 ? `Risk ${delta}` :
            delta > 0 ? `Risk +${delta}` :
            "Risk 0",
        },
      };
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