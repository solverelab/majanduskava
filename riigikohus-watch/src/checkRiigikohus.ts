import type { ApprovedRule, Candidate } from './types.js';
import type { RiigikohusAdapter } from './adapters/riigikohusAdapter.js';
import { isRelevant, makeCandidate } from './generateCandidate.js';
import {
  isContentDuplicate,
  isPendingDuplicate,
  isSeenCase,
} from './deduplicate.js';
import { nextCandidateId, pad4 } from './utils/id.js';

export interface CheckInput {
  keywords: string[];
  seen: string[];
  pending: Candidate[];
  approved: ApprovedRule[];
  adapter: RiigikohusAdapter;
  since?: string;
}

export interface SkippedEntry {
  caseNumber: string;
  reason:
    | 'already seen'
    | 'not relevant (KOS/KÜS or no journey topic)'
    | 'candidate construction failed'
    | 'pending duplicate'
    | 'content duplicate of approved rule';
}

export interface CheckOutput {
  newCandidates: Candidate[];
  updatedSeen: string[];
  skipped: SkippedEntry[];
}

export async function runCheck(input: CheckInput): Promise<CheckOutput> {
  const raws = await input.adapter.fetch(input.keywords, input.since);

  const updatedSeen = [...input.seen];
  const newCandidates: Candidate[] = [];
  const skipped: SkippedEntry[] = [];

  let nextCounter = parseInt(
    nextCandidateId(input.pending).replace('cand_', ''),
    10,
  );

  for (const raw of raws) {
    if (isSeenCase(raw.caseNumber, updatedSeen)) {
      skipped.push({ caseNumber: raw.caseNumber, reason: 'already seen' });
      continue;
    }
    updatedSeen.push(raw.caseNumber);

    if (!isRelevant(raw)) {
      skipped.push({
        caseNumber: raw.caseNumber,
        reason: 'not relevant (KOS/KÜS or no journey topic)',
      });
      continue;
    }

    if (isPendingDuplicate(raw.caseNumber, input.pending)) {
      skipped.push({ caseNumber: raw.caseNumber, reason: 'pending duplicate' });
      continue;
    }

    const id = `cand_${pad4(nextCounter)}`;
    const cand = makeCandidate(raw, id);
    if (!cand) {
      skipped.push({
        caseNumber: raw.caseNumber,
        reason: 'candidate construction failed',
      });
      continue;
    }

    if (isContentDuplicate(cand.candidateBullet, cand.topic, input.approved)) {
      skipped.push({
        caseNumber: raw.caseNumber,
        reason: 'content duplicate of approved rule',
      });
      continue;
    }

    newCandidates.push(cand);
    nextCounter += 1;
  }

  return { newCandidates, updatedSeen, skipped };
}
