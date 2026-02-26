// packages/solvere-core/src/index.ts

// Types & contracts
export type {
  FindingSeverity,
  FindingSource,
  PatchOperation,
  ActionImpact,
  ActionV1,
  FindingV1,
  RiskV1,
  ActionCandidateV1,
  EvaluationTraceV1,
  EvaluationV1,
  RunResultV1,
  RemedyStrategyV1,
  RemedyDefV1,
  PolicyBundleV1,
  SolvereModuleManifestV1,
  GenericUiModelV1,
  UiHintsV1,
  SolvereCoreRuntimeV1,
  SolvereModuleRuntimeV1,
  SolvereModuleHostV1,
  NowFn,
  DeterminismDepsV1,
} from "./solvereCoreV1";

// Runtime values
export { run, defaultDeterminismDeps } from "./solvereCoreV1";

// Patch
export { applyPatch, applyAction, parsePath, PatchError } from "./applyPatch";
export type { PatchErrorCode } from "./applyPatch";

// Host
export { createModuleHost, buildEvaluationSnapshot, buildStateSignature, buildPolicyVersion, canonicalizePatch, assertEvaluationContract, EvaluationContractError, assertModuleContract, ModuleContractError, assertRunReportConsistency, RunReportInconsistentError, NondeterministicSourceError } from "./moduleHost";
export type { EvaluationSnapshot } from "./moduleHost";

// Risk
export { evaluateRiskV1 } from "./evaluateRisk";

// Impact
export { withActionImpacts } from "./computeActionImpact";

// Action candidates
export { buildActionCandidates } from "./buildActionCandidates";

// AutoResolve
export { autoResolve, autoResolveWithHost } from "./autoResolve";
export type { AutoResolveStep, AutoResolveStopReason, AutoResolveStopDetails, AutoResolveResult, RunReportV1, CandidateEligibilityReason, AnnotatedCandidate } from "./autoResolve";

// Registry
export { FINDING_CODES, ACTION_CODES, PRESET_CODES } from "./registry";
