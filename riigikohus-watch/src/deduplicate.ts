import type { ApprovedRule, Candidate, Topic } from './types.js';
import { normalizeText } from './utils/normalize.js';
import { bulletSimilarity } from './utils/similarity.js';

export const SIMILARITY_THRESHOLD = 0.6;

export const isSeenCase = (caseNumber: string, seen: string[]): boolean =>
  seen.some((n) => n.trim() === caseNumber.trim());

export const isPendingDuplicate = (
  caseNumber: string,
  pending: Candidate[],
): boolean =>
  pending.some((c) => c.caseNumber === caseNumber && c.status === 'pending');

export const isContentDuplicate = (
  candidateBullet: string,
  topic: Topic,
  approved: ApprovedRule[],
): boolean => {
  const normCand = normalizeText(candidateBullet);
  return approved.some((rule) => {
    if (rule.topic !== topic) return false;
    const normRule = normalizeText(rule.bullet);
    if (normCand === normRule) return true;
    return bulletSimilarity(normCand, normRule) >= SIMILARITY_THRESHOLD;
  });
};
