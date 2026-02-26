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
import { withActionImpacts } from "./computeActionImpact";
import { buildActionCandidates } from "./buildActionCandidates";

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

export type EvaluationSnapshot = {
  riskScore: number;
  riskLevel: string;
  findingsCount: number;
  findingCodes: string[];
  actionCandidatesCount: number;
};

export function buildEvaluationSnapshot(evaluation: any): EvaluationSnapshot {
  const riskScore = evaluation?.risk?.score ?? evaluation?.riskScore ?? 0;
  const riskLevel = evaluation?.risk?.level ?? "unknown";
  const findings = evaluation?.findings ?? [];
  const findingCodes = findings.map((f: any) => f?.code ?? "").filter(Boolean).sort();
  const actionCandidatesCount = evaluation?.actionCandidates?.length ?? 0;
  return {
    riskScore,
    riskLevel,
    findingsCount: findings.length,
    findingCodes,
    actionCandidatesCount,
  };
}

// ---------------------------------------------------------------------------
// State signature — deterministic, key-order-independent content hash
// ---------------------------------------------------------------------------

function deepCloneWithSortedKeys(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepCloneWithSortedKeys);
  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = deepCloneWithSortedKeys(obj[key]);
  }
  return sorted;
}

function canonicalStringify(obj: any): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  try {
    const keys: string[] = [];
    JSON.stringify(obj, (k, v) => (keys.push(k), v));
    keys.sort();
    return JSON.stringify(obj, keys);
  } catch {
    return String(obj);
  }
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function buildStateSignature(state: any): string {
  const canonical = deepCloneWithSortedKeys(state);
  const c = canonicalStringify(canonical);
  const h1 = fnv1a(c);
  const h2 = fnv1a(h1 + c);
  const sig = h1 + h2;

  // Dev-mode: verify that canonicalStringify alone produces the same result
  // (safety net — if this fires, canonicalStringify has a key-order bug)
  if (IS_DEV) {
    const cRaw = canonicalStringify(state);
    const h1Raw = fnv1a(cRaw);
    const h2Raw = fnv1a(h1Raw + cRaw);
    if (sig !== h1Raw + h2Raw) {
      throw new Error(
        "buildStateSignature: canonical divergence — deepCloneWithSortedKeys and canonicalStringify disagree"
      );
    }
  }

  return sig;
}

export function buildPolicyVersion(bundle: any): string {
  const c = canonicalStringify(bundle);
  const h1 = fnv1a(c);
  const h2 = fnv1a(h1 + c);
  return h1 + h2;
}

export function canonicalizePatch(patch: any): string {
  if (!patch) return "";
  if (!Array.isArray(patch)) {
    // Single object — sort keys deterministically
    try {
      const keys: string[] = [];
      JSON.stringify(patch, (k, v) => (keys.push(k), v));
      keys.sort();
      return JSON.stringify(patch, keys);
    } catch {
      return String(patch);
    }
  }
  // Array of patch operations — sort by (op, path, value) then stringify each
  const ops = patch.map((op: any) => {
    const keys = ["op", "path", "value"].filter((k) => k in op);
    const rest = Object.keys(op).filter((k) => !keys.includes(k)).sort();
    const ordered = [...keys, ...rest];
    return JSON.stringify(op, ordered);
  });
  ops.sort();
  return `[${ops.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Evaluation contract assertion
// ---------------------------------------------------------------------------

const NONDETERMINISTIC_KEYS = new Set([
  "timestamp", "time", "date", "random", "uuid", "nonce", "seed",
  "createdAt", "updatedAt", "generatedAt",
]);

function collectNondeterministicKeys(obj: any, path: string, found: string[]): void {
  if (!obj || typeof obj !== "object") return;
  const entries = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as const)
    : Object.entries(obj);
  for (const [k, v] of entries) {
    if (NONDETERMINISTIC_KEYS.has(k)) found.push(`${path}.${k}`);
    if (v && typeof v === "object") collectNondeterministicKeys(v, `${path}.${k}`, found);
  }
}

export class EvaluationContractError extends Error {
  code = "E_EVAL_CONTRACT_VIOLATION" as const;
  details: { missing: string[]; nondeterministic: string[] };

  constructor(details: { missing: string[]; nondeterministic: string[] }) {
    const parts: string[] = [];
    if (details.missing.length) parts.push(`missing: ${details.missing.join(", ")}`);
    if (details.nondeterministic.length) parts.push(`nondeterministic: ${details.nondeterministic.join(", ")}`);
    super(`E_EVAL_CONTRACT_VIOLATION: ${parts.join("; ")}`);
    this.details = details;
  }
}

export function assertEvaluationContract(evaluation: any): void {
  const missing: string[] = [];
  const nondeterministic: string[] = [];

  // 1. evaluation.schemaVersion
  if (evaluation?.schemaVersion !== "evaluation/v1") {
    missing.push("evaluation.schemaVersion");
  }

  // 2. trace
  if (evaluation?.trace) {
    if (evaluation.trace.schemaVersion !== "trace/v1") {
      missing.push("trace.schemaVersion");
    }
    if (!Array.isArray(evaluation.trace.events)) {
      missing.push("trace.events");
    }
  }

  // 3. actionCandidates
  if (evaluation?.actionCandidates) {
    if (!Array.isArray(evaluation.actionCandidates)) {
      missing.push("actionCandidates");
    } else {
      for (let i = 0; i < evaluation.actionCandidates.length; i++) {
        const c = evaluation.actionCandidates[i];
        const prefix = `actionCandidates[${i}]`;
        if (!c.candidateId) missing.push(`${prefix}.candidateId`);
        if (!c.findingId) missing.push(`${prefix}.findingId`);
        if (!c.action?.code) missing.push(`${prefix}.action.code`);
      }
    }
  }

  // 4. risk snapshot fields
  if (evaluation?.risk) {
    if (typeof evaluation.risk.score !== "number") missing.push("risk.score");
    if (typeof evaluation.risk.level !== "string") missing.push("risk.level");
  }

  // 5. policyVersion
  if (typeof evaluation?.policyVersion !== "string" || !evaluation.policyVersion) {
    missing.push("evaluation.policyVersion");
  }

  // 6. nondeterministic keys in trace and candidates
  if (evaluation?.trace) {
    collectNondeterministicKeys(evaluation.trace, "trace", nondeterministic);
  }
  if (evaluation?.actionCandidates) {
    collectNondeterministicKeys(evaluation.actionCandidates, "actionCandidates", nondeterministic);
  }

  if (missing.length || nondeterministic.length) {
    throw new EvaluationContractError({ missing, nondeterministic });
  }
}

// ---------------------------------------------------------------------------
// Run report consistency assertion
// ---------------------------------------------------------------------------

export class RunReportInconsistentError extends Error {
  code = "E_RUN_REPORT_INCONSISTENT" as const;
  details: { expected: string; actual: string; rule: string };

  constructor(details: { expected: string; actual: string; rule: string }) {
    super(
      `E_RUN_REPORT_INCONSISTENT: ${details.rule} — ` +
      `expected ${details.expected}, got ${details.actual}`
    );
    this.details = details;
  }
}

export function assertRunReportConsistency(
  report: { initial: { stateSignature: string }; final: { stateSignature: string }; stepsTaken: number },
  steps: Array<{ stateSignatureAfter: string }>
): void {
  if (report.stepsTaken > 0) {
    const lastStepSig = steps[steps.length - 1].stateSignatureAfter;
    if (report.final.stateSignature !== lastStepSig) {
      throw new RunReportInconsistentError({
        expected: lastStepSig,
        actual: report.final.stateSignature,
        rule: "final.stateSignature must equal steps[last].stateSignatureAfter",
      });
    }
  } else {
    if (report.final.stateSignature !== report.initial.stateSignature) {
      throw new RunReportInconsistentError({
        expected: report.initial.stateSignature,
        actual: report.final.stateSignature,
        rule: "final.stateSignature must equal initial.stateSignature when stepsTaken === 0",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Module contract assertion (runs early in host.run, before autoResolve)
// ---------------------------------------------------------------------------

export class ModuleContractError extends Error {
  code = "E_MODULE_CONTRACT_VIOLATION" as const;
  details: { violations: string[] };

  constructor(details: { violations: string[] }) {
    super(`E_MODULE_CONTRACT_VIOLATION: ${details.violations.join(", ")}`);
    this.details = details;
  }
}

export function assertModuleContract(evaluation: any): void {
  const violations: string[] = [];

  if (evaluation?.schemaVersion !== "evaluation/v1") {
    violations.push("evaluation.schemaVersion !== \"evaluation/v1\"");
  }

  if (typeof evaluation?.policyVersion !== "string" || !evaluation.policyVersion) {
    violations.push("evaluation.policyVersion missing");
  }

  if (evaluation?.trace?.schemaVersion !== "trace/v1") {
    violations.push("trace.schemaVersion !== \"trace/v1\"");
  }

  if (violations.length) {
    throw new ModuleContractError({ violations });
  }
}

// ---------------------------------------------------------------------------
// Development-mode nondeterminism guard
// ---------------------------------------------------------------------------

export class NondeterministicSourceError extends Error {
  code = "E_NONDETERMINISTIC_SOURCE_USED" as const;
  details: { tampered: string[] };

  constructor(details: { tampered: string[] }) {
    super(`E_NONDETERMINISTIC_SOURCE_USED: ${details.tampered.join(", ")}`);
    this.details = details;
  }
}

type GlobalRef = { name: string; get: () => any };

const GUARDED_REFS: GlobalRef[] = [
  { name: "Date.now", get: () => Date.now },
  { name: "Math.random", get: () => Math.random },
];

function captureGlobalRefs(): Array<{ name: string; ref: any }> {
  return GUARDED_REFS.map((g) => ({ name: g.name, ref: g.get() }));
}

function assertGlobalRefsIntact(before: Array<{ name: string; ref: any }>): void {
  const tampered: string[] = [];
  for (const entry of before) {
    const current = GUARDED_REFS.find((g) => g.name === entry.name)!.get();
    if (current !== entry.ref) {
      tampered.push(entry.name);
    }
  }
  if (tampered.length) {
    throw new NondeterministicSourceError({ tampered });
  }
}

const IS_DEV = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

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

  let _computingImpacts = false;

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

      // Dev-mode: capture global refs before compute/evaluate
      const _devRefs = IS_DEV ? captureGlobalRefs() : null;

      const metrics = module.compute(state);
      const evaluation0 = module.evaluate(state, metrics);
      const evaluation1 = module.resolveActions(evaluation0, state, metrics);

      // Dev-mode: assert global refs intact after compute/evaluate
      if (_devRefs) assertGlobalRefsIntact(_devRefs);

      // Explicitly carry trace from evaluatePolicy through the pipeline.
      // resolveActions may spread evaluation but this guarantees trace survives.
      const trace0 = evaluation0.trace;
      let evaluation = evaluation1;
      if (trace0) {
        const newEvents = (evaluation1.trace?.events ?? []).filter(
          (e) => !(trace0.events ?? []).includes(e)
        );
        evaluation = {
          ...evaluation1,
          trace: { ...trace0, events: [...(trace0.events ?? []), ...newEvents] },
        };
      }

      // Set policyVersion early so module contract check can verify it
      evaluation = { ...evaluation, policyVersion: buildPolicyVersion(policyBundle) };

      const base: RunResultV1<State, Metrics> = {
        schemaVersion: "runResult/v1",
        state,
        metrics,
        evaluation,
      };

      // Skip impact simulation during nested calls (prevents infinite recursion)
      if (_computingImpacts) {
        return base;
      }

      // Module contract check — runs before autoResolve pipeline
      assertModuleContract(evaluation);

      _computingImpacts = true;
      try {
        const withImpacts = withActionImpacts({
          host,
          base,
          options: { maxPerFinding: 3, maxTotal: 12 },
        });
        const withCandidates = buildActionCandidates(withImpacts.evaluation);
        const final = { ...withCandidates, policyVersion: buildPolicyVersion(policyBundle) };
        assertEvaluationContract(final);
        return { ...withImpacts, evaluation: final };
      } finally {
        _computingImpacts = false;
      }
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
