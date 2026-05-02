import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RealRiigikohusAdapter } from '../src/adapters/RealRiigikohusAdapter.js';

const FIX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const readFixture = (name: string): Promise<string> =>
  readFile(path.join(FIX_DIR, name), 'utf-8');

describe('parseDetail fallbackid', () => {
  it('WordSection1 puudub — body tuleb article fallbackist (spec #1)', async () => {
    const html = await readFixture('fallback-no-wordsection.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: 'https://rikos.rik.ee/?asjaNr=3-26-100/5' },
      'majanduskava',
    );
    expect(raw).not.toBeNull();
    expect(raw!.caseNumber).toBe('3-26-100/5');
    expect(raw!.date).toBe('2026-05-15');
    expect(raw!.text).toContain('korteriühistu');
    expect(raw!.text).toContain('majandamiskulude');
    expect(raw!.text.length).toBeGreaterThan(200);
  });

  it('date tuleb ainult üldtekstist "Tartu, X. kuunimi YYYY" (spec #2)', async () => {
    const html = await readFixture('fallback-date-from-text.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: 'https://rikos.rik.ee/?asjaNr=2-26-200/12' },
      'majanduskava',
    );
    expect(raw).not.toBeNull();
    expect(raw!.caseNumber).toBe('2-26-200/12');
    expect(raw!.date).toBe('2026-01-20');
    expect(raw!.text).toContain('Kohtulahend majanduskava');
  });

  it('caseNumber tuleb ainult URL asjaNr-ist, kui HTML seda ei sisalda (spec #3)', async () => {
    const html = await readFixture('fallback-casenr-from-url.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: 'https://rikos.rik.ee/?asjaNr=2-27-999/4' },
      'majanduskava',
    );
    expect(raw).not.toBeNull();
    expect(raw!.caseNumber).toBe('2-27-999/4');
    expect(raw!.date).toBe('2026-02-10');
    expect(raw!.text).toContain('Kohtulahend');
  });

  it('title tuleb esimesest bold-päisest, kui <title> on ainult caseNumber (spec #4)', async () => {
    const html = await readFixture('fallback-title-from-bold.html');
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      html,
      { url: 'https://rikos.rik.ee/?asjaNr=2-26-300/8' },
      'majanduskava',
    );
    expect(raw).not.toBeNull();
    expect(raw!.caseNumber).toBe('2-26-300/8');
    expect(raw!.date).toBe('2026-03-01');
    // title ei tohi olla lihtsalt caseNumber; peab tulema bold-päisest
    expect(raw!.text.startsWith('2-26-300/8')).toBe(false);
    expect(raw!.text).toContain('HALDUSKOLLEEGIUM');
  });

  it('kõik fallbackid läbi kukkudes (ei leia caseNumberit) → null', async () => {
    const brokenHtml = `<!DOCTYPE html><html><head><title></title></head>
      <body><p>See leht ei sisalda midagi kasulikku.</p></body></html>`;
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      brokenHtml,
      { url: 'https://example.org/x' },
      'majanduskava',
    );
    expect(raw).toBeNull();
  });

  it('caseNumber URL-ist + tühi body/title → null (title fallback puudub)', async () => {
    const brokenHtml = `<!DOCTYPE html><html><head><title></title></head>
      <body></body></html>`;
    const adapter = new RealRiigikohusAdapter();
    const raw = adapter.parseDetail(
      brokenHtml,
      { url: 'https://rikos.rik.ee/?asjaNr=9-99-999/1' },
      'majanduskava',
    );
    expect(raw).toBeNull();
  });
});
