// src/policy/contracts.ts

import type { TraceV1 } from "./trace/traceV1";

// Risk schema
export interface RiskV1 {
  score: number;
  level?: string;
  reason?: string;
}

// Finding schema
export interface FindingV1 {
  code: string;
  message?: string;
  severity?: string;
}

// Action schema
export interface ActionV1 {
  code: string;
  label?: string;
  impact?: {
    riskScoreDelta?: number;
  };
  patch?: unknown;
}

// Evaluation schema
export interface EvaluationV1 {
  risk?: RiskV1;
  findings?: FindingV1[];
  actions?: ActionV1[];
  trace?: TraceV1;
}

// AutoResolve step
export interface AutoResolveStepV1 {
  step: number;
  action: ActionV1;
  riskBefore: number;
  riskAfter: number;
  findingsBefore: number;
  findingsAfter: number;
}

export type AutoResolveStopReason =
  | "NO_ACTIONS"
  | "NO_CHOICE"
  | "LOOP_GUARD"
  | "NO_PROGRESS"
  | "MAX_STEPS";

// Resolve debug step (for UI inspection)
export interface ResolveStepV1 {
  i: number;
  evaluation: EvaluationV1;
  chosenAction?: ActionV1;
  patchApplied?: unknown;
}

// AutoResolve result
export interface AutoResolveResultV1<S = unknown> {
  state: S;
  evaluation: EvaluationV1;
  steps: AutoResolveStepV1[];
  stoppedBecause: AutoResolveStopReason;
  debugSteps?: ResolveStepV1[];
}
