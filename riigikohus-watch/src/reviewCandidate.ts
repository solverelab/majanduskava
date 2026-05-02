import type { ApprovedRule, Candidate } from './types.js';
import { nextRuleId } from './utils/id.js';

export interface ReviewState {
  pending: Candidate[];
  approved: ApprovedRule[];
}

const now = (): string => new Date().toISOString();

const findPending = (id: string, state: ReviewState): Candidate => {
  const cand = state.pending.find((c) => c.id === id);
  if (!cand) throw new Error(`Kandidaati id="${id}" ei leitud.`);
  if (cand.status !== 'pending') {
    throw new Error(`Kandidaat id="${id}" ei ole pending staatuses.`);
  }
  return cand;
};

export const approve = (id: string, state: ReviewState): ReviewState => {
  const cand = findPending(id, state);
  const rule: ApprovedRule = {
    id: nextRuleId(state.approved),
    bullet: cand.candidateBullet,
    topic: cand.topic,
    citations: cand.citations,
    sourceKeywords: [cand.keyword],
    approvedAt: now(),
  };
  return {
    pending: state.pending.filter((c) => c.id !== id),
    approved: [...state.approved, rule],
  };
};

export const reject = (id: string, state: ReviewState): ReviewState => {
  findPending(id, state);
  return {
    pending: state.pending.filter((c) => c.id !== id),
    approved: state.approved,
  };
};

export const editThenApprove = (
  id: string,
  newBullet: string,
  state: ReviewState,
): ReviewState => {
  findPending(id, state);
  const trimmed = newBullet.trim();
  if (!trimmed) throw new Error('Uus bullet ei tohi olla tühi.');
  const withEdit: ReviewState = {
    pending: state.pending.map((c) =>
      c.id === id ? { ...c, candidateBullet: trimmed } : c,
    ),
    approved: state.approved,
  };
  return approve(id, withEdit);
};
