// src/policy/trace/traceV1.ts

export type TraceV1 = {
  schemaVersion: "trace/v1";
  evaluationId?: string;
  moduleId?: string;
  policyVersion?: string;
  createdAt?: string;
  events: TraceEventV1[];
};

export type TraceEventV1 =
  | TraceFindingEventV1
  | TraceActionCandidateEventV1
  | TraceActionSelectedEventV1
  | TraceActionAppliedEventV1
  | TraceAutoResolveStopEventV1
  | TraceNoteEventV1;

export type TraceFindingEventV1 = {
  kind: "finding";
  findingCode: string;
  severity?: "info" | "warn" | "error";
  message?: string;
  rule?: RuleRefV1;
  evidence?: EvidenceV1[];
  metrics?: Record<string, number>;
};

export type RankVectorV1 = {
  primary: number;
  secondary: string;
  tertiary: string;
};

export type CandidateEligibilityReasonV1 =
  | "ELIGIBLE"
  | "FILTERED_BY_SEEN"
  | "MISSING_INPUT"
  | "CONFLICTS_WITH_PRESET"
  | "NOT_APPLICABLE"
  | "BLOCKED_BY_CONTRACT";

export type TraceActionCandidateEventV1 = {
  kind: "actionCandidate";
  candidateId: string;
  findingCode: string;
  actionCode: string;
  riskScoreDelta: number;
  eligible: boolean;
  reasons: CandidateEligibilityReasonV1[];
  rankVector: RankVectorV1;
};

export type TraceActionSelectedEventV1 = {
  kind: "actionSelected";
  candidateId: string;
  actionCode: string;
  reason: string;
  riskBefore: number;
};

export type TraceActionAppliedEventV1 = {
  kind: "actionApplied";
  actionCode: string;
  patchSummary: string;
  statePathAffected: string[];
  riskBefore: number;
  riskAfter: number;
};

export type TraceAutoResolveStopEventV1 = {
  kind: "autoResolveStop";
  reason: string;
  finalRisk: number;
  stepsTaken: number;
};

export type TraceNoteEventV1 = {
  kind: "note";
  message: string;
  data?: any;
};

export type RuleRefV1 = {
  id: string;
  label?: string;
};

export type EvidenceV1 = {
  path: string;
  op?: "==" | "!=" | "<" | "<=" | ">" | ">=" | "exists" | "in" | "matches";
  expected?: any;
  actual?: any;
  note?: string;
};

export type ActionImpactV1 = {
  deltaRiskScore?: number;
  deltaFindingsCount?: number;
  explanation?: string;
};

export type PatchPreviewV1 = {
  summary?: string;
  touchedPaths?: string[];
};

// ---------------------------------------------------------------------------
// Evaluation snapshot (lightweight, no trace/evidence/metrics)
// ---------------------------------------------------------------------------

export type EvaluationSnapshotV1 = {
  riskScore: number;
  riskLevel: string;
  findingsCount: number;
  findingCodes: string[];
  actionCandidatesCount: number;
};

// ---------------------------------------------------------------------------
// Step trace types (autoResolve explainability)
// ---------------------------------------------------------------------------

export type LoopGuardV1 = {
  seenKey: string;
  seenCountBefore: number;
  seenCountAfter: number;
};

export type StepTraceV1 = {
  schemaVersion: "stepTrace/v1";
  index: number;
  action: any;
  actionKey?: string;
  stateSignatureBefore: string;
  stateSignatureAfter: string;
  evaluationSnapshotBefore: EvaluationSnapshotV1;
  evaluationSnapshotAfter: EvaluationSnapshotV1;
  delta: {
    riskScore: number;
    findingsCount: number;
  };
  isProgress: boolean;
  actionSelected: {
    candidateId: string;
    reasonCode: string;
    rankVector: RankVectorV1;
    tieBreakUsed: boolean;
  };
  actionApplied: {
    actionCode: string;
    kind: string;
    patch: any;
  };
  loopGuard: LoopGuardV1;
};

export type AutoResolveStopDetailsV1 = {
  seenKeys?: string[];
  seenCount?: number;
  threshold?: number;
  candidatesEligible?: number;
  filteredBySeenCount?: number;
};

export type AutoResolveStopV1 = {
  reason: string;
  stepsTaken: number;
  details?: AutoResolveStopDetailsV1;
};

export type AutoResolveResultV1 = {
  steps: StepTraceV1[];
  stoppedBecause: string;
  stop: AutoResolveStopV1;
  report?: RunReportV1;
};

export type RunReportV1 = {
  schemaVersion: "runReport/v1";
  moduleId: string;
  preset?: string;
  policyVersion?: string;
  reportDigest?: string;
  initial: {
    stateSignature: string;
    riskScore: number;
    findingsCount: number;
  };
  final: {
    stateSignature: string;
    riskScore: number;
    findingsCount: number;
  };
  stepsTaken: number;
  stop: {
    reason: string;
    details?: AutoResolveStopDetailsV1;
  };
  selectedActionCodes: string[];
};
