// solvere-modules/majanduskava/src/compileRemedies.ts

import type {
  ActionV1, EvaluationV1, PatchOperation, PolicyBundleV1, RemedyDefV1, DeterminismDepsV1,
} from "../../../packages/solvere-core/src/solvereCoreV1";
import { defaultDeterminismDeps } from "../../../packages/solvere-core/src/solvereCoreV1";
import type { PlanMetrics, PlanState } from "./types";

function compileOneRemedy(args: {
  remedy: RemedyDefV1; state: PlanState; metrics: PlanMetrics;
  policy: PolicyBundleV1; deps: Required<DeterminismDepsV1>;
}): ActionV1 | null {
  const { remedy, metrics, deps } = args;
  let patch: PatchOperation[] | null = null;

  switch (remedy.strategy) {
    case "set_to": {
      const setToMetric = (remedy.meta as any)?.setToMetric as string | undefined;
      if (setToMetric) {
        let cur: any = metrics as any;
        for (const p of setToMetric.split(".")) cur = cur?.[p];
        if (typeof cur !== "number") return null;
        patch = [{ op: "set", path: remedy.variable.path, value: cur }];
        break;
      }
      if (remedy.value === undefined) return null;
      patch = [{ op: "set", path: remedy.variable.path, value: remedy.value }];
      break;
    }
    case "increase_by": {
      if (typeof remedy.amount !== "number") return null;
      patch = [{ op: "increment", path: remedy.variable.path, value: remedy.amount }];
      break;
    }
    case "decrease_by": {
      if (typeof remedy.amount !== "number") return null;
      patch = [{ op: "decrement", path: remedy.variable.path, value: remedy.amount }];
      break;
    }
    case "increase_until": {
      const target = remedy.target;
      if (!target) return null;
      const current = (metrics as any)?.[target.metric];
      if (typeof current !== "number" || current >= target.min) return null;
      const newValue = (remedy as any)?.fallbackValue;
      if (typeof newValue !== "number") return null;
      patch = [{ op: "set", path: remedy.variable.path, value: newValue }];
      break;
    }
    default: return null;
  }

  return {
    schemaVersion: "action/v1",
    id: deps.makeId(`${remedy.code}|${patch.map((p) => `${p.op}:${p.path}:${String(p.value)}`).join(";")}`),
    code: remedy.code, label: remedy.label, description: remedy.description,
    kind: "patch", patch,
  };
}

export function resolveActions(args: {
  evaluation: EvaluationV1; state: PlanState; metrics: PlanMetrics;
  policy: PolicyBundleV1; deps?: DeterminismDepsV1;
}): EvaluationV1 {
  const deps = { ...defaultDeterminismDeps, ...(args.deps ?? {}) } as Required<DeterminismDepsV1>;
  const { evaluation, policy, state, metrics } = args;
  const remediesMap = policy.remedies ?? {};
  const findings = evaluation.findings.map((f) => {
    const remedyDefs = remediesMap[f.code] ?? [];
    const actions: ActionV1[] = [];
    for (const remedy of remedyDefs) {
      const action = compileOneRemedy({ remedy, state, metrics, policy, deps });
      if (action) actions.push(action);
    }
    return { ...f, actions: actions.length ? actions : f.actions };
  });
  return { ...evaluation, findings };
}
