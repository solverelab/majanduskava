// packages/solvere-core/src/autoResolve.ts
type EvaluationLike = {
  risk?: { score?: number };
  riskScore?: number;
  findings?: Array<{ code?: string }>;
  actions?: any[];
};
export type AutoResolveStep = {
  step: number;
  action: any;
  riskBefore: number;
  riskAfter: number;
  findingsBefore: number;
  findingsAfter: number;
  evaluationBefore?: any;
  evaluationAfter?: any;
};
export type AutoResolveResult<S> = {
  state: S;
  evaluation: EvaluationLike;
  steps: AutoResolveStep[];
  stoppedBecause: "NO_ACTIONS" | "NO_CHOICE" | "LOOP_GUARD" | "NO_PROGRESS" | "MAX_STEPS";
};
function stableStringify(obj: any) {
  try {
    if (!obj || typeof obj !== "object") return String(obj);
    const keys: string[] = [];
    JSON.stringify(obj, (k, v) => (keys.push(k), v));
    keys.sort();
    return JSON.stringify(obj, keys);
  } catch {
    return "[unstringifiable]";
  }
}
function actionKey(action: any) {
  const code = String(action?.code ?? action?.id ?? action?.label ?? "");
  const patch = action?.patch ?? action?.payload ?? action?.remedy ?? null;
  return `${code}::${stableStringify(patch)}`;
}
function pickBestAction(actions: any[]) {
  if (!actions?.length) return null;
  const withDelta = actions.filter((a) => typeof a?.impact?.riskScoreDelta === "number");
  const improving = withDelta.filter((a) => a.impact.riskScoreDelta < 0);
  if (improving.length) {
    improving.sort((a, b) => a.impact.riskScoreDelta - b.impact.riskScoreDelta);
    return improving[0];
  }
  return actions[0];
}
function getRiskScore(ev: EvaluationLike): number {
  return ev?.riskScore ?? ev?.risk?.score ?? 0;
}
export function autoResolve<S>(args: {
  initialState: S;
  evaluate: (state: S) => EvaluationLike;
  apply: (state: S, action: any) => S;
  maxSteps?: number;
}): AutoResolveResult<S> {
  const { evaluate, apply } = args;
  const maxSteps = args.maxSteps ?? 10;
  let state = args.initialState;
  const steps: AutoResolveStep[] = [];
  const seen = new Set<string>();

  // Valikufunktsioon: filtreerib juba rakendatud action'id + valib parima
  function pickAction(
    evaluation: EvaluationLike,
    _state: S
  ): { action: any; stoppedBecause?: AutoResolveResult<S>["stoppedBecause"] } {
    const allActions = evaluation?.actions ?? [];
    if (!allActions.length) return { action: null, stoppedBecause: "NO_ACTIONS" };
    const available = allActions.filter((a) => !seen.has(actionKey(a)));
    if (!available.length) return { action: null, stoppedBecause: "LOOP_GUARD" };
    const best = pickBestAction(available);
    if (!best) return { action: null, stoppedBecause: "NO_CHOICE" };
    return { action: best };
  }

  for (let step = 0; step < maxSteps; step++) {
    const evaluationBefore = evaluate(state); // host.run(state).evaluation
    const riskBefore = evaluationBefore.riskScore ?? evaluationBefore.risk?.score ?? 0;
    const findingsBefore = evaluationBefore.findings?.length ?? 0;

    const picked = pickAction(evaluationBefore, state); // valikuloogika
    if (!picked.action) {
      return {
        state,
        evaluation: evaluationBefore,
        steps,
        stoppedBecause: picked.stoppedBecause!,
      };
    }
    const action = picked.action;
    seen.add(actionKey(action));

    const nextState = apply(state, action); // runtime.applyAction
    const evaluationAfter = evaluate(nextState);
    const riskAfter = evaluationAfter.riskScore ?? evaluationAfter.risk?.score ?? 0;
    const findingsAfter = evaluationAfter.findings?.length ?? 0;

    steps.push({
      step,
      action,
      riskBefore,
      riskAfter,
      findingsBefore,
      findingsAfter,
      evaluationBefore,
      evaluationAfter,
    });

    // Progress check — loop-guard jääb samaks
    const progressed = riskAfter < riskBefore || findingsAfter < findingsBefore;
    if (!progressed) {
      return { state, evaluation: evaluationAfter, steps, stoppedBecause: "NO_PROGRESS" };
    }

    state = nextState;
  }

  // Final evaluation for return
  const finalEval = evaluate(state);
  return { state, evaluation: finalEval, steps, stoppedBecause: "MAX_STEPS" };
}
export function autoResolveWithHost<S>(args: {
  host: { run: (state: S) => { evaluation: EvaluationLike } };
  runtime: { applyAction: (state: S, action: any) => S };
  initialState: S;
  maxSteps?: number;
}): AutoResolveResult<S> {
  return autoResolve({
    initialState: args.initialState,
    evaluate: (s) => args.host.run(s).evaluation,
    apply: (s, a) => args.runtime.applyAction(s, a),
    maxSteps: args.maxSteps,
  });
}
