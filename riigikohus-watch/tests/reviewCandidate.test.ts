import { describe, it, expect } from 'vitest';
import { approve, editThenApprove, reject } from '../src/reviewCandidate.js';
import type { Candidate, ApprovedRule } from '../src/types.js';

const makeCand = (id: string, bullet = 'vaikeblok'): Candidate => ({
  id,
  caseNumber: '2-23-204',
  date: '2026-01-07',
  keyword: 'majanduskava',
  topic: 'kinnitamine',
  candidateBullet: bullet,
  citations: [{ caseNumber: '2-23-204', points: '14-17' }],
  status: 'pending',
  createdAt: '2026-01-07T00:00:00.000Z',
});

describe('approve (spec #4)', () => {
  it('liigutab kandidaadi approved nimekirja ja eemaldab pendingust', () => {
    const state = { pending: [makeCand('cand_0001')], approved: [] as ApprovedRule[] };
    const next = approve('cand_0001', state);
    expect(next.pending).toHaveLength(0);
    expect(next.approved).toHaveLength(1);
    expect(next.approved[0].id).toBe('rule_0001');
    expect(next.approved[0].bullet).toBe('vaikeblok');
    expect(next.approved[0].topic).toBe('kinnitamine');
  });

  it('rule_id kasvab järjekorras', () => {
    const pre: ApprovedRule[] = [
      {
        id: 'rule_0003',
        bullet: 'x',
        topic: 'kutse',
        citations: [],
        sourceKeywords: [],
        approvedAt: '2026-01-07T00:00:00.000Z',
      },
    ];
    const next = approve('cand_0001', {
      pending: [makeCand('cand_0001')],
      approved: pre,
    });
    expect(next.approved[next.approved.length - 1].id).toBe('rule_0004');
  });

  it('olematu id viskab vea', () => {
    expect(() => approve('cand_9999', { pending: [], approved: [] })).toThrow();
  });
});

describe('reject (spec #5)', () => {
  it('eemaldab kandidaadi pendingust ega lisa approved nimekirja', () => {
    const state = { pending: [makeCand('cand_0001')], approved: [] as ApprovedRule[] };
    const next = reject('cand_0001', state);
    expect(next.pending).toHaveLength(0);
    expect(next.approved).toHaveLength(0);
  });

  it('olematu id viskab vea', () => {
    expect(() => reject('cand_9999', { pending: [], approved: [] })).toThrow();
  });
});

describe('editThenApprove (spec #6)', () => {
  it('salvestab muudetud teksti approved nimekirja', () => {
    const state = {
      pending: [makeCand('cand_0001', 'vana bullet')],
      approved: [] as ApprovedRule[],
    };
    const next = editThenApprove('cand_0001', 'uus lihvitud bullet', state);
    expect(next.pending).toHaveLength(0);
    expect(next.approved).toHaveLength(1);
    expect(next.approved[0].bullet).toBe('uus lihvitud bullet');
  });

  it('tühi tekst viskab vea', () => {
    const state = {
      pending: [makeCand('cand_0001')],
      approved: [] as ApprovedRule[],
    };
    expect(() => editThenApprove('cand_0001', '   ', state)).toThrow();
  });
});
