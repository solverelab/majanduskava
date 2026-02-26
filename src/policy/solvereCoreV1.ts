/* @solvere/core — solvereCoreV1.ts
 * Solvere Core Contracts (v1)
 * Focus: deterministic facts → compute → policy → findings → actions → apply patch
 */

//
// ---------- Finding / Action / Patch / Risk / Evaluation (v1) ----------
//

export type FindingSeverity = "error" | "warning" | "info";
export type FindingSource = "compute" | "policy" | "external";

export interface PatchOperation {
  op: "set" | "increment" | "decrement";
  /** Dot segments + optional [index], e.g. "loans[0].termMonths" */
  path: string;
  /** set: number|string|boolean ; increment/decrement: number only */
  value: number | string | boolean;
}

export interface ActionImpact {
  riskScoreDelta?: number;
  cashflowDeltaMonthly?: number;
  liquidityDelta?: number;
  summary?: string;
}

export interface ActionV1 {
  schemaVersion: "action/v1";
  /** Unique instance id (deterministic or DI-generated) */
  id: string;
  /** Stable machine code, e.g. "ADJUST_REPAIR_FUND_RATE" */
  code: string;
  /** UI label for a button */
  label: string;
  description?: string;
  kind: "patch"; // v1 supports only declarative patches
  patch: PatchOperation[];
  impact?: ActionImpact;
  meta?: Record<string, unknown>;
}

export interface FindingV1 {
  schemaVersion: "finding/v1";
  /** Unique instance id (deterministic or DI-generated) */
  id: string;
  /** Stable machine code, e.g. "RF_NEG" */
  code: string;
  source: FindingSource;
  severity: FindingSeverity;
  /** Short human label */
  title: string;
  /** User-facing explanation */
  message: string;
  /** Optional affected field path in State */
  path?: string;
  /** Optional logical metric name */
  metric?: string;
  /** Raw values used in evaluation (audit/debug) */
  context?: Record<string, unknown>;
  /** Actions are already resolved by runtime (UI does not map remedies) */
  actions?: ActionV1[];
  tags?: string[];
  /** ISO timestamp (may be DI-controlled for determinism) */
  createdAt: string;
}

export interface RiskV1 {
  schemaVersion: "risk/v1";
  level: "low" | "medium" | "high";
  /** Recommended range 0..100 */
  score: number;
  band?: string;
  reason?: string;
  meta?: Record<string, unknown>;
}

export interface EvaluationV1 {
  schemaVersion: "evaluation/v1";
  findings: FindingV1[];
  hasErrors: boolean;
  risk?: RiskV1;
}

export interface RunResultV1<State, Metrics> {
  schemaVersion: "runResult/v1";
  state: State;
  metrics: Metrics;
  evaluation: EvaluationV1; // with actions resolved
}

//
// ---------- Policy bundle (v1) ----------
//

export type RemedyStrategyV1 =
  | "set_to"
  | "increase_by"
  | "decrease_by"
  | "increase_until";

export interface RemedyDefV1 {
  /** Action code to be produced (stable) */
  code: string;
  label: string;
  description?: string;
  strategy: RemedyStrategyV1;
  /** Which State variable will be patched */
  variable: { path: string };
  /** strategy: set_to */
  value?: number | string | boolean;
  /** strategy: increase_by / decrease_by */
  amount?: number;
  /** strategy: increase_until */
  target?: { metric: string; min: number };
  /** Optional hint for UI/notes (runtime may ignore) */
  step?: number;
  meta?: Record<string, unknown>;
}

export interface PolicyBundleV1 {
  schemaVersion: "policyBundle/v1";
  presetCode: string;              // "BALANCED"
  limits: Record<string, unknown>; // soft/hard thresholds
  scoring?: Record<string, unknown>;
  bands?: Record<string, unknown>;
  // Remedies mapping: findingCode -> list of remedy defs
  remedies?: Record<string, RemedyDefV1[]>;
}

//
// ---------- Module contracts (v1) ----------
//

export interface SolvereModuleManifestV1 {
  schemaVersion: "moduleManifest/v1";
  moduleId: string;            // "majanduskava"
  moduleVersion: string;       // semver
  title: string;               // "Majanduskava"
  description?: string;
  stateSchemaId: string;       // e.g. "majanduskava/state/v1"
  metricsSchemaId: string;     // e.g. "majanduskava/metrics/v1"
  defaultPolicyPreset: string; // "BALANCED"
  policyPresets: string[];     // ["BALANCED","CONSERVATIVE","LOAN_FRIENDLY"]
}

//
// ---------- UI layer (presentational, never affects logic) ----------
//

export type GenericUiModelV1 = {
  state: unknown;
  metrics: unknown;
  evaluation: EvaluationV1; // findings with actions embedded
};

export interface UiHintsV1 {
  schemaVersion: "uiHints/v1";
  // purely presentational, never affects logic
  fieldLabels?: Record<string, string>;    // path -> label
  fieldGroups?: Array<{ title: string; paths: string[] }>;
  severityOrder?: FindingSeverity[];
}

//
// ---------- Core runtime contract (v1) ----------
//

export interface SolvereCoreRuntimeV1<State, Metrics> {
  runtimeVersion: "runtime/v1";

  compute(state: State): Metrics;

  /**
   * Evaluate policy and produce findings/risk. MUST NOT modify state.
   * May return findings without actions; actions are attached in resolveActions().
   */
  evaluate(state: State, metrics: Metrics): EvaluationV1;

  /**
   * Compile remedies into concrete ActionV1.patch and attach to findings.
   * MUST be deterministic for same inputs (state+metrics+policy).
   */
  resolveActions(
    evaluation: EvaluationV1,
    state: State,
    metrics: Metrics
  ): EvaluationV1;

  /**
   * Apply patch operations to state.
   * v1 recommended behavior: fail-fast, all-or-nothing, no implicit path creation.
   */
  applyPatch(state: State, patch: PatchOperation[]): State;

  /** Convenience: apply action = applyPatch(action.patch) */
  applyAction(state: State, action: ActionV1): State;
}

export interface SolvereModuleRuntimeV1<State, Metrics>
  extends SolvereCoreRuntimeV1<State, Metrics> {
  // Module metadata
  manifest: SolvereModuleManifestV1;
  // Policy loader (preset -> YAML/JSON object)
  loadPolicy(presetCode: string): PolicyBundleV1;
  // Optional: default initial state factory (starter template)
  createInitialState?(): State;
  // Optional presentation hints
  uiHints?: UiHintsV1;
}

export interface SolvereModuleHostV1<State, Metrics> {
  module: SolvereModuleRuntimeV1<State, Metrics>;
  preset: string;
  run(state: State): RunResultV1<State, Metrics>;
  applyActionAndRun(state: State, action: ActionV1): RunResultV1<State, Metrics>;
  setPreset(preset: string): void; // changes which policy bundle is used
}

//
// ---------- Convenience runner ----------
//

export function run<State, Metrics>(
  rt: SolvereCoreRuntimeV1<State, Metrics>,
  state: State
): RunResultV1<State, Metrics> {
  const metrics = rt.compute(state);
  const evaluation = rt.resolveActions(rt.evaluate(state, metrics), state, metrics);
  return { schemaVersion: "runResult/v1", state, metrics, evaluation };
}

//
// ---------- Determinism helpers ----------
//

export type NowFn = () => string; // ISO timestamp

export interface DeterminismDepsV1 {
  now?: NowFn;
  /** optional deterministic id generator */
  makeId?: (input: string) => string;
}

/** Default deps: real clock + content-based id */
export const defaultDeterminismDeps: Required<DeterminismDepsV1> = {
  now: () => new Date().toISOString(),
  makeId: (input: string) => input,
};
export { autoResolve } from "../../packages/solvere-core/src/autoResolve";
