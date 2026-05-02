import { describe, it, expect } from 'vitest';
import { runCheck } from '../src/checkRiigikohus.js';
import { StubRiigikohusAdapter } from '../src/adapters/riigikohusAdapter.js';
import type { RawCase } from '../src/types.js';

const relevantCase: RawCase = {
  caseNumber: '2-23-204',
  date: '2026-01-07',
  keyword: 'majanduskava',
  era: 'KrtS',
  text: 'KrtS § 41 alusel üldkoosolek kinnitab majanduskava tagasiulatuvalt.',
  proposedBullet: 'Majanduskava võib vajadusel kinnitada ka tagasiulatuvalt.',
  citations: [{ caseNumber: '2-23-204', points: '14-17' }],
};

describe('runCheck', () => {
  it('uus lahend → pending kandidaat tekib (spec #1)', async () => {
    const adapter = new StubRiigikohusAdapter([relevantCase]);
    const out = await runCheck({
      keywords: ['majanduskava'],
      seen: [],
      pending: [],
      approved: [],
      adapter,
    });
    expect(out.newCandidates).toHaveLength(1);
    expect(out.newCandidates[0].caseNumber).toBe('2-23-204');
    expect(out.newCandidates[0].topic).toBe('kinnitamine');
    expect(out.newCandidates[0].status).toBe('pending');
    expect(out.updatedSeen).toContain('2-23-204');
  });

  it('sama lahend teist korda → uut kandidaati ei teki (spec #2)', async () => {
    const adapter = new StubRiigikohusAdapter([relevantCase]);
    const out = await runCheck({
      keywords: ['majanduskava'],
      seen: ['2-23-204'],
      pending: [],
      approved: [],
      adapter,
    });
    expect(out.newCandidates).toHaveLength(0);
    expect(out.skipped).toEqual([
      { caseNumber: '2-23-204', reason: 'already seen' },
    ]);
  });

  it('KOS-ajastu lahend ei tekita pendingut ja märgitakse seen-iks', async () => {
    const kosCase: RawCase = {
      ...relevantCase,
      caseNumber: '3-2-1-99-10',
      era: 'KOS',
      text: 'korteriomandiseaduse alusel majanduskava kinnitamine',
    };
    const adapter = new StubRiigikohusAdapter([kosCase]);
    const out = await runCheck({
      keywords: ['majanduskava'],
      seen: [],
      pending: [],
      approved: [],
      adapter,
    });
    expect(out.newCandidates).toHaveLength(0);
    expect(out.updatedSeen).toContain('3-2-1-99-10');
    expect(out.skipped[0].reason).toMatch(/not relevant/);
  });

  it('id-d suurenevad olemasolevate pending-kandidaatide kohal', async () => {
    const adapter = new StubRiigikohusAdapter([relevantCase]);
    const out = await runCheck({
      keywords: ['majanduskava'],
      seen: [],
      pending: [
        {
          id: 'cand_0007',
          caseNumber: 'X',
          date: '2025-01-01',
          keyword: 'majanduskava',
          topic: 'kinnitamine',
          candidateBullet: 'vana',
          citations: [],
          status: 'pending',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      approved: [],
      adapter,
    });
    expect(out.newCandidates[0].id).toBe('cand_0008');
  });
});
