/* @solvere/core — moduleHost.ts
 * Reference implementation: SolvereModuleHost v1
 */
import type {
  ActionV1,
  DeterminismDepsV1,
  PolicyBundleV1,
  RunResultV1,
  SolvereModuleHostV1,
  SolvereModuleRuntimeV1,
} from "./solvereCoreV1";

/** Optional extension: policy injection into runtime (recommended pattern). */
type PolicyAwareRuntime = {
  setPolicyBundle: (bundle: PolicyBundleV1) => void;
};

function isPolicyAwareRuntime(x: any): x is PolicyAwareRuntime {
  return x && typeof x.setPolicyBundle === "function";
}

/** Optional extension: determinism deps injection. */
type DepsAwareRuntime = {
  setDeterminismDeps: (deps: DeterminismDepsV1) => void;
};

function isDepsAwareRuntime(x: any): x is DepsAwareRuntime {
  return x && typeof x.setDeterminismDeps === "function";
}

function assertPresetAllowed(module: SolvereModuleRuntimeV1<any, any>, preset: string) {
  const allowed = module.manifest.policyPresets;
  if (!allowed.includes(preset)) {
    throw new Error(
      `Preset "${preset}" is not allowed for module "${module.manifest.moduleId}". ` +
        `Allowed: ${allowed.join(", ")}`
    );
  }
}

export function createModuleHost<State, Metrics>(args: {
  module: SolvereModuleRuntimeV1<State, Metrics>;
  preset?: string;
  deps?: DeterminismDepsV1;
}): SolvereModuleHostV1<State, Metrics> {
  const module = args.module;
  let preset =
    args.preset ?? module.manifest.defaultPolicyPreset ?? module.manifest.policyPresets[0];

  assertPresetAllowed(module, preset);

  // Inject determinism deps if runtime supports it
  if (args.deps && isDepsAwareRuntime(module)) {
    module.setDeterminismDeps(args.deps);
  }

  // Load initial policy bundle and inject if runtime supports it
  let policyBundle: PolicyBundleV1 = module.loadPolicy(preset);
  if (isPolicyAwareRuntime(module)) {
    module.setPolicyBundle(policyBundle);
  }

  const host: SolvereModuleHostV1<State, Metrics> = {
    module,

    get preset() {
      return preset;
    },
    set preset(_) {
      // ignore: preset is controlled via setPreset()
    },

    run(state: State): RunResultV1<State, Metrics> {
      if (isPolicyAwareRuntime(module)) {
        module.setPolicyBundle(policyBundle);
      }

      const metrics = module.compute(state);
      const evaluation0 = module.evaluate(state, metrics);
      const evaluation = module.resolveActions(evaluation0, state, metrics);

      return {
        schemaVersion: "runResult/v1",
        state,
        metrics,
        evaluation,
      };
    },

    applyActionAndRun(state: State, action: ActionV1): RunResultV1<State, Metrics> {
      const newState = module.applyAction(state, action);
      return host.run(newState);
    },

    setPreset(newPreset: string): void {
      assertPresetAllowed(module, newPreset);
      preset = newPreset;
      policyBundle = module.loadPolicy(preset);
      if (isPolicyAwareRuntime(module)) {
        module.setPolicyBundle(policyBundle);
      }
    },
  };

  return host;
}
