import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, type RunSummary } from '../src/reportPending.js';
import type { Candidate } from '../src/types.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const mkSummary = (over: Partial<RunSummary> = {}): RunSummary => ({
  adapter: 'real',
  indexEntriesParsed: 20,
  detailPagesParsed: 19,
  canonicalResults: 19,
  candidatesCreated: 2,
  duplicatesSkipped: 0,
  newCandidateIds: [],
  generatedAt: '2026-04-19T12:00:00.000Z',
  ...over,
});

const mkCand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  caseNumber: '2-23-204/40',
  date: '2026-01-07',
  keyword: 'majanduskava',
  topic: 'kinnitamine',
  candidateBullet: 'Majanduskava võib vajadusel kinnitada ka tagasiulatuvalt.',
  citations: [{ caseNumber: '2-23-204', points: '14-17' }],
  status: 'pending',
  createdAt: '2026-04-19T12:00:00.000Z',
  ...over,
});

describe('buildReport', () => {
  it('genereerib markdowni kui uusi pending kandidaate on (spec #1)', () => {
    const summary = mkSummary({
      candidatesCreated: 2,
      newCandidateIds: ['cand_0007', 'cand_0008'],
    });
    const pending = [
      mkCand('cand_0006', { candidateBullet: 'Vana pending — ei tohi reporti sattuda' }),
      mkCand('cand_0007'),
      mkCand('cand_0008', {
        caseNumber: '2-18-12753/34',
        topic: 'kulude_jaotus',
        candidateBullet: 'Majanduskavas ei saa kulude jaotust suvaliselt ümber teha.',
        citations: [{ caseNumber: '2-18-12753', points: '' }],
      }),
    ];
    const md = buildReport(summary, pending);

    expect(md).toContain('# Riigikohtu watch report');
    expect(md).toContain('- Adapter: real');
    expect(md).toContain('- Index entries parsed: 20');
    expect(md).toContain('- Detail pages parsed: 19');
    expect(md).toContain('- Canonical results: 19');
    expect(md).toContain('- Candidates created: 2');
    expect(md).toContain('- Duplicates skipped: 0');
    expect(md).toContain('## Uued pending kandidaadid');
    expect(md).toContain('### cand_0007');
    expect(md).toContain('### cand_0008');
    // vanad pending ei tohi loetellu sattuda
    expect(md).not.toContain('### cand_0006');
    expect(md).not.toContain('Vana pending');
    // tsitatsioonid on vormistatud
    expect(md).toContain('- Viited: 2-23-204, p 14-17');
    expect(md).toContain('- Viited: 2-18-12753');
    expect(md).not.toContain('## Tulemus');
  });

  it('genereerib "0 uut kandidaati" väljundi kui newCandidateIds on tühi (spec #2)', () => {
    const summary = mkSummary({
      canonicalResults: 20,
      candidatesCreated: 0,
      newCandidateIds: [],
    });
    const md = buildReport(summary, []);
    expect(md).toContain('# Riigikohtu watch report');
    expect(md).toContain('- Candidates created: 0');
    expect(md).toContain('## Tulemus');
    expect(md).toContain('Uusi pending kandidaate ei tekkinud.');
    expect(md).not.toContain('## Uued pending kandidaadid');
  });

  it('näitab "—" kui stub adapter (stats puuduvad)', () => {
    const summary = mkSummary({
      adapter: 'stub',
      indexEntriesParsed: null,
      detailPagesParsed: null,
      canonicalResults: null,
      candidatesCreated: 0,
      newCandidateIds: [],
    });
    const md = buildReport(summary, []);
    expect(md).toContain('- Adapter: stub');
    expect(md).toContain('- Index entries parsed: —');
    expect(md).toContain('- Detail pages parsed: —');
    expect(md).toContain('- Canonical results: —');
  });

  it('eirab vanu pending kandidaate, mis pole selles jooksus lisatud', () => {
    const summary = mkSummary({
      candidatesCreated: 1,
      newCandidateIds: ['cand_NEW'],
    });
    const pending = [
      mkCand('cand_OLD1'),
      mkCand('cand_OLD2'),
      mkCand('cand_NEW', { topic: 'vaidlustamine' }),
    ];
    const md = buildReport(summary, pending);
    expect(md).toContain('### cand_NEW');
    expect(md).not.toContain('### cand_OLD1');
    expect(md).not.toContain('### cand_OLD2');
  });
});

describe('report CLI — summary-faili puudumisel (spec #4)', () => {
  it('viskab selge vea, kui last_run_summary.json puudub', () => {
    const summaryPath = path.join(ROOT, 'data', 'last_run_summary.json');
    let backup: string | null = null;
    if (existsSync(summaryPath)) {
      backup = readFileSync(summaryPath, 'utf-8');
      unlinkSync(summaryPath);
    }
    try {
      const result = spawnSync(
        'npx',
        ['tsx', 'src/cli/report.ts'],
        {
          cwd: ROOT,
          encoding: 'utf-8',
          shell: true,
        },
      );
      const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status).not.toBe(0);
      expect(combined).toMatch(/last_run_summary\.json puudub/);
    } finally {
      if (backup !== null) writeFileSync(summaryPath, backup, 'utf-8');
    }
  }, 10_000);
});

describe('workflow + package.json kooskõla (spec #3)', () => {
  it('workflow fail eksisteerib ja sisaldab õigeid skripte', () => {
    const wf = path.resolve(
      ROOT,
      '..',
      '.github',
      'workflows',
      'riigikohus-watch-monthly.yml',
    );
    expect(existsSync(wf)).toBe(true);
    const text = readFileSync(wf, 'utf-8');
    expect(text).toContain('RIIGIKOHUS_ADAPTER: real');
    expect(text).toContain('npm run check');
    expect(text).toContain('npm run report');
    expect(text).toContain('schedule:');
    expect(text).toContain('workflow_dispatch');
    expect(text).toContain('upload-artifact');
    expect(text).toContain('working-directory: ./riigikohus-watch');
  });

  it('package.json sisaldab check ja report skripte', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, 'package.json'), 'utf-8'),
    );
    expect(pkg.scripts.check).toBeDefined();
    expect(pkg.scripts.report).toBeDefined();
    expect(pkg.scripts.check).toMatch(/src\/cli\/check\.ts/);
    expect(pkg.scripts.report).toMatch(/src\/cli\/report\.ts/);
  });
});
