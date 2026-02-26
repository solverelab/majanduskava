// packages/solvere-core/src/autoResolve.ts

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionCandidateLike = {
  candidateId: string;
  findingId: string;
  findingCode: string;
  actionCode: string;
  action: any;
  riskScoreDelta: number;
  isEligible: boolean;
  rank: number;
};

export type CandidateEligibilityReason =
  | "ELIGIBLE"
  | "FILTERED_BY_SEEN"
  | "MISSING_INPUT"
  | "CONFLICTS_WITH_PRESET"
  | "NOT_APPLICABLE"
  | "BLOCKED_BY_CONTRACT";

export type AnnotatedCandidate = ActionCandidateLike & {
  eligible: boolean;
  reasons: CandidateEligibilityReason[];
};

type EvaluationLike = {
  risk?: { score?: number; level?: string };
  riskScore?: number;
  policyVersion?: string;
  findings?: Array<{ code?: string; id?: string; severity?: string; actions?: any[] }>;
  actions?: any[];
  actionCandidates?: ActionCandidateLike[];
  trace?: { events?: Array<Record<string, unknown>>; [key: string]: unknown };
};

type EvaluationSnapshot = {
  riskScore: number;
  riskLevel: string;
  findingsCount: number;
  findingCodes: string[];
  actionCandidatesCount: number;
};

type RankVector = {
  primary: number;
  secondary: string;
  tertiary: string;
};

export type AutoResolveStep = {
  schemaVersion: "stepTrace/v1";
  index: number;
  action: any;
  actionKey?: string;
  stateSignatureBefore: string;
  stateSignatureAfter: string;
  evaluationSnapshotBefore: EvaluationSnapshot;
  evaluationSnapshotAfter: EvaluationSnapshot;
  delta: {
    riskScore: number;
    findingsCount: number;
  };
  isProgress: boolean;
  actionSelected: {
    candidateId: string;
    reasonCode: string;
    rankVector: RankVector;
    tieBreakUsed: boolean;
  };
  actionApplied: {
    actionCode: string;
    kind: string;
    patch: any;
  };
  loopGuard: {
    seenKey: string;
    seenCountBefore: number;
    seenCountAfter: number;
  };
};

export type AutoResolveStopReason =
  | "NO_ACTIONS"
  | "NO_CHOICE"
  | "LOOP_GUARD"
  | "NO_PROGRESS"
  | "MAX_STEPS";

export type AutoResolveStopDetails = {
  seenKeys?: string[];
  seenCount?: number;
  threshold?: number;
  candidatesEligible?: number;
  filteredBySeenCount?: number;
  candidateReasons?: Array<{
    candidateId: string;
    eligible: boolean;
    reasons: CandidateEligibilityReason[];
  }>;
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
    reason: AutoResolveStopReason;
    details?: AutoResolveStopDetails;
  };
  selectedActionCodes: string[];
};

export type AutoResolveResult<S> = {
  state: S;
  evaluation: EvaluationLike;
  steps: AutoResolveStep[];
  stoppedBecause: AutoResolveStopReason;
  stop: {
    reason: AutoResolveStopReason;
    stepsTaken: number;
    details?: AutoResolveStopDetails;
  };
  report?: RunReportV1;
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

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

function fnv1aLocal(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function buildStateSignatureLocal(state: any): string {
  const c = stableStringify(state);
  const h1 = fnv1aLocal(c);
  const h2 = fnv1aLocal(h1 + c);
  return h1 + h2;
}

function assertRunReportConsistencyLocal(
  report: RunReportV1,
  steps: AutoResolveStep[]
): void {
  if (report.stepsTaken > 0) {
    const lastStepSig = steps[steps.length - 1].stateSignatureAfter;
    if (report.final.stateSignature !== lastStepSig) {
      throw new Error(
        `E_RUN_REPORT_INCONSISTENT: final.stateSignature must equal steps[last].stateSignatureAfter` +
        ` — expected ${lastStepSig}, got ${report.final.stateSignature}`
      );
    }
  } else {
    if (report.final.stateSignature !== report.initial.stateSignature) {
      throw new Error(
        `E_RUN_REPORT_INCONSISTENT: final.stateSignature must equal initial.stateSignature when stepsTaken === 0` +
        ` — expected ${report.initial.stateSignature}, got ${report.final.stateSignature}`
      );
    }
  }
}

function buildReportDigest(report: RunReportV1): string {
  const digestInput = {
    policyVersion: report.policyVersion ?? "",
    preset: report.preset ?? "",
    initial: report.initial,
    final: report.final,
    stepsTaken: report.stepsTaken,
    stop: report.stop,
    selectedActionCodes: report.selectedActionCodes,
  };
  const c = stableStringify(digestInput);
  const h1 = fnv1aLocal(c);
  const h2 = fnv1aLocal(h1 + c);
  return h1 + h2;
}

function actionKey(action: any) {
  const code = String(action?.code ?? action?.id ?? action?.label ?? "");
  const patch = action?.patch ?? action?.payload ?? action?.remedy ?? null;
  return `${code}::${stableStringify(patch)}`;
}

function getRiskScore(ev: EvaluationLike): number {
  return ev?.riskScore ?? ev?.risk?.score ?? 0;
}

function buildSnapshot(ev: EvaluationLike): EvaluationSnapshot {
  const findings = ev?.findings ?? [];
  return {
    riskScore: getRiskScore(ev),
    riskLevel: ev?.risk?.level ?? "unknown",
    findingsCount: findings.length,
    findingCodes: findings.map((f) => f?.code ?? "").filter(Boolean).sort(),
    actionCandidatesCount: ev?.actionCandidates?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Candidate-based selection (used when actionCandidates present)
// ---------------------------------------------------------------------------

function canonicalizePatchLocal(patch: any): string {
  if (!patch) return "";
  if (!Array.isArray(patch)) {
    try {
      const keys: string[] = [];
      JSON.stringify(patch, (k, v) => (keys.push(k), v));
      keys.sort();
      return JSON.stringify(patch, keys);
    } catch {
      return String(patch);
    }
  }
  const ops = patch.map((op: any) => {
    const keys = ["op", "path", "value"].filter((k) => k in op);
    const rest = Object.keys(op).filter((k) => !keys.includes(k)).sort();
    const ordered = [...keys, ...rest];
    return JSON.stringify(op, ordered);
  });
  ops.sort();
  return `[${ops.join(",")}]`;
}

function buildSeenKey(candidateId: string, patch: any): string {
  return `${candidateId}::${canonicalizePatchLocal(patch)}`;
}

function buildRankVector(c: ActionCandidateLike): RankVector {
  return {
    primary: c.riskScoreDelta,
    secondary: c.actionCode,
    tertiary: c.candidateId,
  };
}

function compareRankVectors(a: RankVector, b: RankVector): number {
  if (a.primary !== b.primary) return a.primary - b.primary;
  if (a.secondary !== b.secondary) return a.secondary.localeCompare(b.secondary);
  return a.tertiary.localeCompare(b.tertiary);
}

type PickStopInfo = {
  candidatesEligible: number;
  filteredBySeenCount: number;
  annotatedCandidates: AnnotatedCandidate[];
};

function pickFromCandidates(
  evaluation: EvaluationLike,
  seen: Set<string>
):
  | { action: any; candidate: AnnotatedCandidate; rankVector: RankVector; tieBreakUsed: boolean; seenKey: string; annotatedCandidates: AnnotatedCandidate[]; stoppedBecause?: undefined; stopInfo?: undefined }
  | { action: null; candidate?: undefined; rankVector?: undefined; tieBreakUsed?: undefined; seenKey?: undefined; annotatedCandidates: AnnotatedCandidate[]; stoppedBecause: AutoResolveStopReason; stopInfo?: PickStopInfo } {
  const candidates = evaluation.actionCandidates!;
  if (!candidates.length) return { action: null, stoppedBecause: "NO_ACTIONS", annotatedCandidates: [] };

  // Annotate all candidates with eligibility reasons before selection
  const annotated: AnnotatedCandidate[] = candidates.map((c) => {
    if (!c.isEligible) {
      return { ...c, eligible: false, reasons: ["NOT_APPLICABLE" as CandidateEligibilityReason] };
    }
    const sk = buildSeenKey(c.candidateId, c.action?.patch);
    if (seen.has(sk)) {
      return { ...c, eligible: false, reasons: ["FILTERED_BY_SEEN" as CandidateEligibilityReason] };
    }
    return { ...c, eligible: true, reasons: ["ELIGIBLE" as CandidateEligibilityReason] };
  });

  // Selection only from eligible === true candidates
  const eligible = annotated.filter((c) => c.eligible);
  const eligibleBeforeSeenCount = candidates.filter((c) => c.isEligible).length;
  const filteredBySeenCount = annotated.filter((c) => c.reasons.includes("FILTERED_BY_SEEN")).length;

  if (!eligible.length) {
    return {
      action: null,
      stoppedBecause: "NO_CHOICE",
      annotatedCandidates: annotated,
      stopInfo: { candidatesEligible: eligibleBeforeSeenCount, filteredBySeenCount, annotatedCandidates: annotated },
    };
  }

  // Build rankVector for each, sort by primary ASC → secondary ASC → tertiary ASC
  const ranked = eligible.map((c) => ({ c, rv: buildRankVector(c) }));
  ranked.sort((a, b) => compareRankVectors(a.rv, b.rv));

  const best = ranked[0];
  const tieBreakUsed = ranked.length > 1 && ranked[1].rv.primary === best.rv.primary;
  const seenKey = buildSeenKey(best.c.candidateId, best.c.action?.patch);

  return { action: best.c.action, candidate: best.c, rankVector: best.rv, tieBreakUsed, seenKey, annotatedCandidates: annotated };
}

// ---------------------------------------------------------------------------
// Legacy actions-based selection (fallback — no actionCandidates)
// ---------------------------------------------------------------------------

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

function pickFromActions(
  evaluation: EvaluationLike,
  seen: Set<string>
):
  | { action: any; candidate?: undefined; seenKey: string; stoppedBecause?: undefined }
  | { action: null; candidate?: undefined; seenKey?: undefined; stoppedBecause: AutoResolveStopReason } {
  const allActions = evaluation?.actions ?? [];
  if (!allActions.length) return { action: null, stoppedBecause: "NO_ACTIONS" };
  const available = allActions.filter((a) => !seen.has(buildSeenKey(actionKey(a), a?.patch)));
  if (!available.length) return { action: null, stoppedBecause: "LOOP_GUARD" };
  const best = pickBestAction(available);
  if (!best) return { action: null, stoppedBecause: "NO_CHOICE" };
  const seenKey = buildSeenKey(actionKey(best), best?.patch);
  return { action: best, seenKey };
}

// ---------------------------------------------------------------------------
// Main autoResolve loop
// ---------------------------------------------------------------------------

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

  for (let step = 0; step < maxSteps; step++) {
    const evaluationBefore = evaluate(state);
    const snapBefore = buildSnapshot(evaluationBefore);

    // Prefer actionCandidates if available, fallback to legacy actions
    const useCandidates = !!(evaluationBefore.actionCandidates?.length);
    const picked = useCandidates
      ? pickFromCandidates(evaluationBefore, seen)
      : pickFromActions(evaluationBefore, seen);

    if (!picked.action) {
      const reason = picked.stoppedBecause!;
      const stopObj: AutoResolveResult<S>["stop"] = { reason, stepsTaken: steps.length };
      if (reason === "LOOP_GUARD") {
        stopObj.details = {
          seenKeys: [...seen],
          seenCount: seen.size,
          threshold: maxSteps,
        };
      }
      if (reason === "NO_CHOICE" && useCandidates && picked.stopInfo) {
        stopObj.details = {
          seenKeys: [...seen],
          seenCount: seen.size,
          candidatesEligible: picked.stopInfo.candidatesEligible,
          filteredBySeenCount: picked.stopInfo.filteredBySeenCount,
          candidateReasons: picked.stopInfo.annotatedCandidates.map((c) => ({
            candidateId: c.candidateId,
            eligible: c.eligible,
            reasons: c.reasons,
          })),
        };
      }
      return {
        state,
        evaluation: evaluationBefore,
        steps,
        stoppedBecause: reason,
        stop: stopObj,
      };
    }

    const action = picked.action;
    const candidateId = useCandidates && picked.candidate
      ? picked.candidate.candidateId
      : actionKey(action);
    const rankVector: RankVector = useCandidates && picked.rankVector
      ? picked.rankVector
      : { primary: action?.impact?.riskScoreDelta ?? 0, secondary: action?.code ?? "", tertiary: candidateId };
    const tieBreakUsed = useCandidates ? (picked.tieBreakUsed ?? false) : false;

    // Build seenKey from candidateId + canonical patch
    const seenKey = useCandidates && picked.seenKey
      ? picked.seenKey
      : buildSeenKey(candidateId, action?.patch);

    const seenCountBefore = seen.size;
    seen.add(seenKey);
    const seenCountAfter = seen.size;

    const sigBefore = buildStateSignatureLocal(state);
    const nextState = apply(state, action);
    const sigAfter = buildStateSignatureLocal(nextState);
    const evaluationAfter = evaluate(nextState);
    const snapAfter = buildSnapshot(evaluationAfter);

    const riskScoreDelta = snapAfter.riskScore - snapBefore.riskScore;
    const findingsCountDelta = snapAfter.findingsCount - snapBefore.findingsCount;
    // State signature match overrides risk/findings — no state change = no progress
    const isProgress = sigAfter !== sigBefore && (riskScoreDelta < 0 || findingsCountDelta < 0);

    steps.push({
      schemaVersion: "stepTrace/v1",
      index: step,
      action,
      actionKey: candidateId,
      stateSignatureBefore: sigBefore,
      stateSignatureAfter: sigAfter,
      evaluationSnapshotBefore: snapBefore,
      evaluationSnapshotAfter: snapAfter,
      delta: {
        riskScore: riskScoreDelta,
        findingsCount: findingsCountDelta,
      },
      isProgress,
      actionSelected: {
        candidateId,
        reasonCode: "LOWEST_PRIMARY_RANK",
        rankVector,
        tieBreakUsed,
      },
      actionApplied: {
        actionCode: action?.code ?? "",
        kind: action?.kind ?? "patch",
        patch: action?.patch ?? null,
      },
      loopGuard: {
        seenKey,
        seenCountBefore,
        seenCountAfter,
      },
    });

    if (!isProgress) {
      return {
        state,
        evaluation: evaluationAfter,
        steps,
        stoppedBecause: "NO_PROGRESS",
        stop: { reason: "NO_PROGRESS", stepsTaken: steps.length },
      };
    }

    state = nextState;
  }

  // Final evaluation for return
  const finalEval = evaluate(state);
  return {
    state,
    evaluation: finalEval,
    steps,
    stoppedBecause: "MAX_STEPS",
    stop: { reason: "MAX_STEPS", stepsTaken: steps.length },
  };
}

export function autoResolveWithHost<S>(args: {
  host: {
    run: (state: S) => { evaluation: EvaluationLike };
    preset?: string;
    module?: { manifest?: { moduleId?: string } };
  };
  runtime: { applyAction: (state: S, action: any) => S };
  initialState: S;
  maxSteps?: number;
}): AutoResolveResult<S> {
  const initialSig = buildStateSignatureLocal(args.initialState);
  const initialEval = args.host.run(args.initialState).evaluation;
  const initialSnap = buildSnapshot(initialEval);

  const result = autoResolve({
    initialState: args.initialState,
    evaluate: (s) => args.host.run(s).evaluation,
    apply: (s, a) => args.runtime.applyAction(s, a),
    maxSteps: args.maxSteps,
  });

  const finalSig = buildStateSignatureLocal(result.state);
  const finalSnap = buildSnapshot(result.evaluation);

  result.report = {
    schemaVersion: "runReport/v1",
    moduleId: args.host.module?.manifest?.moduleId ?? "",
    preset: args.host.preset ?? "",
    policyVersion: initialEval.policyVersion ?? "",
    initial: {
      stateSignature: initialSig,
      riskScore: initialSnap.riskScore,
      findingsCount: initialSnap.findingsCount,
    },
    final: {
      stateSignature: finalSig,
      riskScore: finalSnap.riskScore,
      findingsCount: finalSnap.findingsCount,
    },
    stepsTaken: result.stop.stepsTaken,
    stop: {
      reason: result.stop.reason,
      details: result.stop.details,
    },
    selectedActionCodes: result.steps.map((s) => s.actionApplied.actionCode),
  };

  result.report.reportDigest = buildReportDigest(result.report);

  assertRunReportConsistencyLocal(result.report, result.steps);

  return result;
}
