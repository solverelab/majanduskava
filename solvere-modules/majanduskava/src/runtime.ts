// solvere-modules/majanduskava/src/runtime.ts

import type {
  PolicyBundleV1, SolvereModuleRuntimeV1, EvaluationV1, DeterminismDepsV1,
} from "../../../packages/solvere-core/src/solvereCoreV1";
import { defaultDeterminismDeps } from "../../../packages/solvere-core/src/solvereCoreV1";
import { applyPatch, applyAction } from "../../../packages/solvere-core/src/applyPatch";
import { manifest } from "./manifest";
import { loadPolicy } from "./policyLoader";
import { evaluatePolicy } from "./evaluatePolicy";
import { resolveActions as resolveActionsWithPolicy } from "./compileRemedies";
import type { PlanMetrics, PlanState } from "./types";
import { computePlan } from "../../../src/engine/computePlan.js";

export function createMajanduskavaRuntime(
  initialDeps: DeterminismDepsV1 = {}
): SolvereModuleRuntimeV1<PlanState, PlanMetrics> & {
  setPolicyBundle(bundle: PolicyBundleV1): void;
  setDeterminismDeps(next: DeterminismDepsV1): void;
} {
  let deps: Required<DeterminismDepsV1> = { ...defaultDeterminismDeps, ...initialDeps };
  let activePolicy: PolicyBundleV1 | null = null;

  return {
    runtimeVersion: "runtime/v1",
    manifest,
    loadPolicy: (presetCode) => loadPolicy(presetCode),
    setPolicyBundle(bundle) { activePolicy = bundle; },
    setDeterminismDeps(next) { deps = { ...defaultDeterminismDeps, ...next }; },
    compute: (state) => computePlan(state),
    evaluate(state, metrics) {
      if (!activePolicy) activePolicy = loadPolicy(manifest.defaultPolicyPreset);
      return evaluatePolicy({ state, metrics, policy: activePolicy, deps });
    },
    resolveActions(evaluation, state, metrics) {
      if (!activePolicy) activePolicy = loadPolicy(manifest.defaultPolicyPreset);
      return resolveActionsWithPolicy({ evaluation, state, metrics, policy: activePolicy, deps });
    },
    applyPatch: (state, ops) => applyPatch(state, ops),
    applyAction: (state, action) => applyAction(state, action),
    createInitialState: () => ({} as any),
  };
}
