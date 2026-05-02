import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RealRiigikohusAdapter } from '../src/adapters/RealRiigikohusAdapter.js';
import {
  StubRiigikohusAdapter,
} from '../src/adapters/riigikohusAdapter.js';
import {
  selectAdapter,
  resolveChoice,
} from '../src/adapters/selectAdapter.js';
import { runCheck } from '../src/checkRiigikohus.js';

const FIX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const readFixture = (name: string): Promise<string> =>
  readFile(path.join(FIX_DIR, name), 'utf-8');

const BASE = 'https://www.riigikohus.ee/et/lahendid';

type FakeFetch = typeof fetch;

const buildFakeFetch = (pages: Record<string, { status: number; body: string }>): FakeFetch => {
  return (async (input: unknown): Promise<Response> => {
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
};

describe('RealRiigikohusAdapter.parseIndex', () => {
  it('parsib indekslehe fixture-ist lahendite lingid ja kuupäevad (spec #1)', async () => {
    const html = await readFixture('index.html');
    const adapter = new RealRiigikohusAdapter();
    const entries = adapter.parseIndex(html, BASE);
    const caseNumbers = entries.map((e) => e.caseNumber).sort();
    expect(caseNumbers).toEqual(['2-23-204', '2-24-100', '9-99-999']);
    const first = entries.find((e) => e.caseNumber === '2-23-204')!;
    expect(first.date).toBe('2026-01-07');
    expect(first.url).toBe('https://www.riigikohus.ee/et/lahendid/2-23-204');
    expect(first.category).toBe('Tsiviilkolleegium');
  });
});

describe('RealRiigikohusAdapter.parseDetail', () => {
  it('parsib detaillehe fixture-ist caseNumber, date, title, bodyText (spec #2)', async () => {
    const html = await readFixture('case-2-23-204.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: `${BASE}/2-23-204` },
      'majanduskava',
    );
    expect(raw).not.toBeNull();
    expect(raw!.caseNumber).toBe('2-23-204');
    expect(raw!.date).toBe('2026-01-07');
    expect(raw!.text).toContain('Üldkoosoleku otsuse tühisus');
    expect(raw!.text).toContain('tagasiulatuvalt');
    expect(raw!.keyword).toBe('majanduskava');
    expect(raw!.citations).toEqual([{ caseNumber: '2-23-204', points: '' }]);
  });

  it('tagastab null kui detaillehel puuduvad kriitilised väljad', async () => {
    const html = await readFixture('case-broken.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: `${BASE}/9-99-999` },
      'majanduskava',
    );
    expect(raw).toBeNull();
  });
});

describe('RealRiigikohusAdapter.fetch — end-to-end fake network', () => {
  it('jätab katkise kirje vahele, jätkab jooksu (spec #3)', async () => {
    const indexHtml = await readFixture('index.html');
    const good1 = await readFixture('case-2-23-204.html');
    const good2 = await readFixture('case-2-24-100.html');
    const broken = await readFixture('case-broken.html');
    const warnings: string[] = [];

    const adapter = new RealRiigikohusAdapter({
      indexUrls: [BASE],
      logger: (m) => warnings.push(m),
      http: buildFakeFetch({
        [BASE]: { status: 200, body: indexHtml },
        [`${BASE}/2-23-204`]: { status: 200, body: good1 },
        [`${BASE}/2-24-100`]: { status: 200, body: good2 },
        [`${BASE}/9-99-999`]: { status: 200, body: broken },
      }),
    });

    const out = await adapter.fetch(['majanduskava']);
    expect(out.map((r) => r.caseNumber).sort()).toEqual([
      '2-23-204',
      '2-24-100',
    ]);
    expect(warnings.some((w) => w.includes('warn: skipped'))).toBe(true);
    expect(warnings.some((w) => w.includes('canonical results: 2'))).toBe(true);
  });

  it('index fetch ebaõnnestumise korral viskab selge vea (spec: network fail)', async () => {
    const adapter = new RealRiigikohusAdapter({
      indexUrls: [BASE],
      logger: () => {},
      http: buildFakeFetch({}),
    });
    await expect(adapter.fetch(['majanduskava'])).rejects.toThrow(
      /Riigikohus index fetch failed/,
    );
  });

  it('detaillehe HTTP-viga logitakse hoiatusena, ei crash', async () => {
    const indexHtml = await readFixture('index.html');
    const good1 = await readFixture('case-2-23-204.html');
    const warnings: string[] = [];

    const adapter = new RealRiigikohusAdapter({
      indexUrls: [BASE],
      logger: (m) => warnings.push(m),
      http: buildFakeFetch({
        [BASE]: { status: 200, body: indexHtml },
        [`${BASE}/2-23-204`]: { status: 200, body: good1 },
      }),
    });
    const out = await adapter.fetch(['majanduskava']);
    expect(out.map((r) => r.caseNumber)).toEqual(['2-23-204']);
    expect(
      warnings.some((w) => w.includes('HTTP 404') || w.includes('fetch/parse error')),
    ).toBe(true);
  });
});

describe('adapteri väljund sobib check flow-ga (spec #4)', () => {
  it('real-adapter tekitab pending kandidaadi läbi runCheck', async () => {
    const indexHtml = await readFixture('index.html');
    const good1 = await readFixture('case-2-23-204.html');
    const good2 = await readFixture('case-2-24-100.html');
    const broken = await readFixture('case-broken.html');

    const adapter = new RealRiigikohusAdapter({
      indexUrls: [BASE],
      logger: () => {},
      http: buildFakeFetch({
        [BASE]: { status: 200, body: indexHtml },
        [`${BASE}/2-23-204`]: { status: 200, body: good1 },
        [`${BASE}/2-24-100`]: { status: 200, body: good2 },
        [`${BASE}/9-99-999`]: { status: 200, body: broken },
      }),
    });

    const out = await runCheck({
      keywords: ['majanduskava'],
      seen: [],
      pending: [],
      approved: [],
      adapter,
    });
    expect(out.newCandidates.length).toBeGreaterThan(0);
    expect(
      out.newCandidates.map((c) => c.caseNumber).includes('2-23-204'),
    ).toBe(true);
  });
});

describe('selectAdapter — env-lüliti (spec #6)', () => {
  it('RIIGIKOHUS_ADAPTER=real valib RealRiigikohusAdapter', () => {
    const { adapter, choice } = selectAdapter({
      env: { RIIGIKOHUS_ADAPTER: 'real' },
    });
    expect(choice).toBe('real');
    expect(adapter).toBeInstanceOf(RealRiigikohusAdapter);
  });

  it('RIIGIKOHUS_ADAPTER=stub (ja vaikimisi) valib Stubi', () => {
    expect(
      selectAdapter({ env: { RIIGIKOHUS_ADAPTER: 'stub' } }).adapter,
    ).toBeInstanceOf(StubRiigikohusAdapter);
    expect(selectAdapter({ env: {} }).adapter).toBeInstanceOf(
      StubRiigikohusAdapter,
    );
  });

  it('resolveChoice normaliseerib juhuslikku casingut', () => {
    expect(resolveChoice({ RIIGIKOHUS_ADAPTER: 'REAL' })).toBe('real');
    expect(resolveChoice({ RIIGIKOHUS_ADAPTER: 'xyz' })).toBe('stub');
  });
});

describe('stub jääb tööle (spec #5)', () => {
  it('StubRiigikohusAdapter tagastab fixtured nagu varem', async () => {
    const stub = new StubRiigikohusAdapter([
      {
        caseNumber: 'X-1',
        date: '2026-01-01',
        keyword: 'majanduskava',
        text: 'KrtS majanduskava kinnitamine',
      },
    ]);
    const out = await stub.fetch(['majanduskava']);
    expect(out).toHaveLength(1);
    expect(out[0].caseNumber).toBe('X-1');
  });
});
