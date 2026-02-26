/* @solvere/core — solvereCoreV1.ts
 * Solvere Core Contracts (v1)
 */

//
// ---------- Finding / Action / Patch / Risk / Evaluation (v1) ----------
//

export type FindingSeverity = "error" | "warning" | "info";
export type FindingSource = "compute" | "policy" | "external";

export interface PatchOperation {
  op: "set" | "increment" | "decrement";
  path: string;
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
  id: string;
  code: string;
  label: string;
  description?: string;
  kind: "patch";
  patch: PatchOperation[];
  impact?: ActionImpact;
  meta?: Record<string, unknown>;
}

export interface FindingV1 {
  schemaVersion: "finding/v1";
  id: string;
  code: string;
  source: FindingSource;
  severity: FindingSeverity;
  title: string;
  message: string;
  path?: string;
  metric?: string;
  context?: Record<string, unknown>;
  actions?: ActionV1[];
  tags?: string[];
  createdAt: string;
}

export interface RiskV1 {
  schemaVersion: "risk/v1";
  level: "low" | "medium" | "high";
  score: number;
  band?: string;
  reason?: string;
  meta?: Record<string, unknown>;
}

export interface ActionCandidateV1 {
  candidateId: string;
  findingId: string;
  findingCode: string;
  actionCode: string;
  action: ActionV1;
  riskScoreDelta: number;
  isEligible: boolean;
  rank: number;
}

export interface EvaluationTraceV1 {
  schemaVersion?: string;
  events: Array<Record<string, unknown>>;
}

export interface EvaluationV1 {
  schemaVersion: "evaluation/v1";
  findings: FindingV1[];
  hasErrors: boolean;
  risk?: RiskV1;
  policyVersion?: string;
  actionCandidates?: ActionCandidateV1[];
  trace?: EvaluationTraceV1;
}

export interface RunResultV1<State, Metrics> {
  schemaVersion: "runResult/v1";
  state: State;
  metrics: Metrics;
  evaluation: EvaluationV1;
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
  code: string;
  label: string;
  description?: string;
  strategy: RemedyStrategyV1;
  variable: { path: string };
  value?: number | string | boolean;
  amount?: number;
  target?: { metric: string; min: number };
  step?: number;
  meta?: Record<string, unknown>;
}

export interface PolicyBundleV1 {
  schemaVersion: "policyBundle/v1";
  presetCode: string;
  limits: Record<string, unknown>;
  scoring?: Record<string, unknown>;
  bands?: Record<string, unknown>;
  remedies?: Record<string, RemedyDefV1[]>;
}

//
// ---------- Module contracts (v1) ----------
//

export interface SolvereModuleManifestV1 {
  schemaVersion: "moduleManifest/v1";
  moduleId: string;
  moduleVersion: string;
  title: string;
  description?: string;
  stateSchemaId: string;
  metricsSchemaId: string;
  defaultPolicyPreset: string;
  policyPresets: string[];
}

export type GenericUiModelV1 = {
  state: unknown;
  metrics: unknown;
  evaluation: EvaluationV1;
};

export interface UiHintsV1 {
  schemaVersion: "uiHints/v1";
  fieldLabels?: Record<string, string>;
  fieldGroups?: Array<{ title: string; paths: string[] }>;
  severityOrder?: FindingSeverity[];
}

//
// ---------- Core runtime contract (v1) ----------
//

export interface SolvereCoreRuntimeV1<State, Metrics> {
  runtimeVersion: "runtime/v1";
  compute(state: State): Metrics;
  evaluate(state: State, metrics: Metrics): EvaluationV1;
  resolveActions(
    evaluation: EvaluationV1,
    state: State,
    metrics: Metrics
  ): EvaluationV1;
  applyPatch(state: State, patch: PatchOperation[]): State;
  applyAction(state: State, action: ActionV1): State;
}

export interface SolvereModuleRuntimeV1<State, Metrics>
  extends SolvereCoreRuntimeV1<State, Metrics> {
  manifest: SolvereModuleManifestV1;
  loadPolicy(presetCode: string): PolicyBundleV1;
  createInitialState?(): State;
  uiHints?: UiHintsV1;
}

export interface SolvereModuleHostV1<State, Metrics> {
  module: SolvereModuleRuntimeV1<State, Metrics>;
  preset: string;
  run(state: State): RunResultV1<State, Metrics>;
  applyActionAndRun(state: State, action: ActionV1): RunResultV1<State, Metrics>;
  setPreset(preset: string): void;
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

export type NowFn = () => string;

export interface DeterminismDepsV1 {
  now?: NowFn;
  makeId?: (input: string) => string;
}

export const defaultDeterminismDeps: Required<DeterminismDepsV1> = {
  now: () => new Date().toISOString(),
  makeId: (input: string) => input,
};
