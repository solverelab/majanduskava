import { tokens } from './normalize.js';

const intersectSize = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

export const jaccard = (a: string, b: string): number => {
  const wa = new Set(tokens(a));
  const wb = new Set(tokens(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  const inter = intersectSize(wa, wb);
  const union = wa.size + wb.size - inter;
  return union === 0 ? 0 : inter / union;
};

export const bulletSimilarity = (a: string, b: string): number => {
  const wa = new Set(tokens(a));
  const wb = new Set(tokens(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  const inter = intersectSize(wa, wb);
  const j = inter / (wa.size + wb.size - inter);
  const overlap = inter / Math.max(wa.size, wb.size);
  return Math.max(j, overlap);
};
