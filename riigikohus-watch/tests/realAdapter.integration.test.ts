import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RealRiigikohusAdapter } from '../src/adapters/RealRiigikohusAdapter.js';
import { runCheck } from '../src/checkRiigikohus.js';

const FIX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const readFixture = (name: string): Promise<string> =>
  readFile(path.join(FIX_DIR, name), 'utf-8');

const RIIGIKOHUS_BASE = 'https://www.riigikohus.ee/et/lahendid';

type FakeFetch = typeof fetch;
const buildFakeFetch = (
  pages: Record<string, { status: number; body: string }>,
): FakeFetch =>
  (async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    const entry = pages[url];
    if (!entry) {
      return new Response('', { status: 404, statusText: 'Not Found' });
    }
    return new Response(entry.body, {
      status: entry.status,
      statusText: entry.status === 200 ? 'OK' : 'ERR',
    });
  }) as FakeFetch;

describe('RealRiigikohusAdapter — päris HTML struktuuri peal', () => {
  it('parseIndex leiab päris indeks-HTML-ist detaillehe lingid (spec #1)', async () => {
    const html = await readFixture('riigikohus-index-1.html');
    const adapter = new RealRiigikohusAdapter();
    const entries = adapter.parseIndex(html, RIIGIKOHUS_BASE);

    // riigikohus.ee/et/lahendid lehel on ~20 hiljutist lahendit
    // nelja kolleegiumi kaupa 4-veerulises tabelis
    expect(entries.length).toBeGreaterThanOrEqual(15);
    // caseNumber peab sisaldama /NN dokumendi-suffiksit
    const withSuffix = entries.filter((e) => /\/\d+$/.test(e.caseNumber ?? ''));
    expect(withSuffix.length).toBeGreaterThan(0);
    // url peab olema rikos.rik.ee peal (iframe sihtsüsteem)
    expect(entries.every((e) => e.url.startsWith('https://rikos.rik.ee/'))).toBe(
      true,
    );
    // iga kirje peaks omama kuupäeva DD.MM.YYYY vormingust
    expect(entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(
      true,
    );
  });

  it('parseIndex töötab ka teise indeks-fixture-i peal (sama menüü-struktuur)', async () => {
    const html = await readFixture('riigikohus-index-2.html');
    const adapter = new RealRiigikohusAdapter();
    const entries = adapter.parseIndex(html, RIIGIKOHUS_BASE);
    expect(entries.length).toBeGreaterThanOrEqual(15);
    expect(
      entries.find((e) => e.caseNumber === '2-20-11727/108'),
    ).toBeDefined();
  });

  it('parseDetail loeb päris rikos-HTML-ist caseNumber, date, title, bodyText (spec #2)', async () => {
    const html = await readFixture('riigikohus-detail-2-20-11727.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: 'https://rikos.rik.ee/?asjaNr=2-20-11727/108' },
      'majanduskava',
    );
    expect(raw).not.toBeNull();
    expect(raw!.caseNumber).toBe('2-20-11727/108');
    expect(raw!.date).toBe('2026-04-15');
    expect(raw!.text.length).toBeGreaterThan(500);
    expect(raw!.text.toLowerCase()).toContain('tsiviilkolleegium');
  });

  it('parseDetail toodab canonical result objekti kõigi kolme reaalfixture-i peal (spec #3)', async () => {
    const adapter = new RealRiigikohusAdapter();
    const fixtures = [
      { file: 'riigikohus-detail-2-20-11727.html', caseNumber: '2-20-11727/108' },
      { file: 'riigikohus-detail-3-22-2263.html', caseNumber: '3-22-2263/35' },
      { file: 'riigikohus-detail-2-17-11639.html', caseNumber: '2-17-11639/326' },
    ];
    for (const fx of fixtures) {
      const html = await readFixture(fx.file);
      const raw = adapter.parseDetail(
        html,
        { url: `https://rikos.rik.ee/?asjaNr=${fx.caseNumber}` },
        'majanduskava',
      );
      expect(raw, `${fx.file} -> canonical result`).not.toBeNull();
      expect(raw!.caseNumber).toBe(fx.caseNumber);
      expect(raw!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(raw!.text.length).toBeGreaterThan(500);
    }
  });

  it('katkine detailfixture skipitakse, kogu jooks ei katke (spec #4)', async () => {
    const indexHtml = await readFixture('riigikohus-index-1.html');
    const good = await readFixture('riigikohus-detail-2-20-11727.html');
    const broken = await readFixture('case-broken.html');
    const warnings: string[] = [];

    const adapter = new RealRiigikohusAdapter({
      indexUrls: [RIIGIKOHUS_BASE],
      limit: 2,
      logger: (m) => warnings.push(m),
      http: buildFakeFetch({
        [RIIGIKOHUS_BASE]: { status: 200, body: indexHtml },
        // esimene entry on indeksis 3-22-2263/35 (halduskolleegium), anname selle katki,
        // teine entry on 2-20-11727/108 (tsiviil), anname selle ok
        'https://rikos.rik.ee/?asjaNr=3-22-2263/35': {
          status: 200,
          body: broken,
        },
        'https://rikos.rik.ee/?asjaNr=2-20-11727/108': {
          status: 200,
          body: good,
        },
      }),
    });

    const out = await adapter.fetch(['majanduskava']);
    // üks õnnestus, üks skipiti
    expect(out.map((r) => r.caseNumber)).toEqual(['2-20-11727/108']);
    expect(
      warnings.some((w) => w.includes('warn: skipped (missing fields)')),
    ).toBe(true);
  });

  it('check-flow töötab real adapteriga fixture-põhiselt (spec #5)', async () => {
    const indexHtml = await readFixture('riigikohus-index-1.html');
    const d1 = await readFixture('riigikohus-detail-2-20-11727.html');
    const d2 = await readFixture('riigikohus-detail-3-22-2263.html');
    const d3 = await readFixture('riigikohus-detail-2-17-11639.html');

    const adapter = new RealRiigikohusAdapter({
      indexUrls: [RIIGIKOHUS_BASE],
      limit: 3,
      logger: () => {},
      http: buildFakeFetch({
        [RIIGIKOHUS_BASE]: { status: 200, body: indexHtml },
        'https://rikos.rik.ee/?asjaNr=3-22-2263/35': { status: 200, body: d2 },
        'https://rikos.rik.ee/?asjaNr=2-20-11727/108': { status: 200, body: d1 },
        'https://rikos.rik.ee/?asjaNr=1-24-5035/92': {
          status: 404,
          body: '',
        },
        'https://rikos.rik.ee/?asjaNr=2-17-11639/326': { status: 200, body: d3 },
      }),
    });

    const result = await runCheck({
      keywords: ['majanduskava'],
      seen: [],
      pending: [],
      approved: [],
      adapter,
    });

    // runCheck peab töötama ilma vigadeta ja seen-nimekiri peab sisaldama
    // päris case-numbreid /NN-suffiksiga
    expect(result.updatedSeen.some((n) => n.includes('/'))).toBe(true);
    // kõik käsitletud kirjed (uued + skipped) peavad kokku olema >0
    expect(
      result.newCandidates.length + result.skipped.length,
    ).toBeGreaterThan(0);
  });
});
