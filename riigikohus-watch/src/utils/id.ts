export const pad4 = (n: number): string => String(n).padStart(4, '0');

export const nextCandidateId = (existing: { id: string }[]): string => {
  const max = existing.reduce((m, c) => {
    const match = c.id.match(/^cand_(\d+)$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `cand_${pad4(max + 1)}`;
};

export const nextRuleId = (existing: { id: string }[]): string => {
  const max = existing.reduce((m, r) => {
    const match = r.id.match(/^rule_(\d+)$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `rule_${pad4(max + 1)}`;
};
