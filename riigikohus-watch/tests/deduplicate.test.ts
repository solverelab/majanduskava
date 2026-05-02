import { describe, it, expect } from 'vitest';
import {
  isContentDuplicate,
  isPendingDuplicate,
  isSeenCase,
} from '../src/deduplicate.js';
import { runCheck } from '../src/checkRiigikohus.js';
import { StubRiigikohusAdapter } from '../src/adapters/riigikohusAdapter.js';
import type { ApprovedRule, Candidate, RawCase } from '../src/types.js';

describe('isSeenCase', () => {
  it('leiab, kui lahend on juba nähtud', () => {
    expect(isSeenCase('2-23-204', ['2-23-204'])).toBe(true);
  });
  it('talub tühikuid', () => {
    expect(isSeenCase('2-23-204 ', [' 2-23-204'])).toBe(true);
  });
});

describe('isPendingDuplicate', () => {
  it('tuvastab sama lahendi pendingus', () => {
    const pending: Candidate[] = [
      {
        id: 'cand_0001',
        caseNumber: '2-23-204',
        date: '2026-01-07',
        keyword: 'majanduskava',
        topic: 'kinnitamine',
        candidateBullet: 'x',
        citations: [],
        status: 'pending',
        createdAt: '2026-01-07T00:00:00.000Z',
      },
    ];
    expect(isPendingDuplicate('2-23-204', pending)).toBe(true);
    expect(isPendingDuplicate('2-23-999', pending)).toBe(false);
  });
});

describe('isContentDuplicate', () => {
  const approved: ApprovedRule[] = [
    {
      id: 'rule_0001',
      bullet: 'Majanduskava võib vajadusel kinnitada ka tagasiulatuvalt.',
      topic: 'kinnitamine',
      citations: [],
      sourceKeywords: ['majanduskava'],
      approvedAt: '2026-01-07T00:00:00.000Z',
    },
  ];

  it('sama sisuga bullet tuvastatakse dubletina (spec #3)', () => {
    expect(
      isContentDuplicate(
        'Majanduskava võib tagasiulatuvalt kinnitada, kui vajalik.',
        'kinnitamine',
        approved,
      ),
    ).toBe(true);
  });

  it('erineva teemaga bullet pole dublett', () => {
    expect(
      isContentDuplicate(
        'Majanduskava võib vajadusel kinnitada ka tagasiulatuvalt.',
        'kutse',
        approved,
      ),
    ).toBe(false);
  });

  it('täiesti erineva sõnastusega bullet pole dublett', () => {
    expect(
      isContentDuplicate(
        'Kvoorum nõuab vähemalt poolte omanike osalemist.',
        'kinnitamine',
        approved,
      ),
    ).toBe(false);
  });
});

describe('runCheck — sisuline dubletikaitse', () => {
  it('sisuline dublett ei lisa uut kandidaati (integration)', async () => {
    const raw: RawCase = {
      caseNumber: '2-24-100',
      date: '2026-02-01',
      keyword: 'majanduskava',
      era: 'KrtS',
      text: 'üldkoosolek kinnitab majanduskava tagasiulatuvalt KrtS § 41',
      proposedBullet: 'Majanduskava võib tagasiulatuvalt kinnitada.',
    };
    const approved: ApprovedRule[] = [
      {
        id: 'rule_0001',
        bullet: 'Majanduskava võib vajadusel kinnitada ka tagasiulatuvalt.',
        topic: 'kinnitamine',
        citations: [],
        sourceKeywords: ['majanduskava'],
        approvedAt: '2026-01-07T00:00:00.000Z',
      },
    ];
    const adapter = new StubRiigikohusAdapter([raw]);
    const out = await runCheck({
      keywords: ['majanduskava'],
      seen: [],
      pending: [],
      approved,
      adapter,
    });
    expect(out.newCandidates).toHaveLength(0);
    expect(out.skipped[0].reason).toBe('content duplicate of approved rule');
  });
});
