import { load } from 'cheerio';
import type { RawCase } from '../types.js';
import type { RiigikohusAdapter } from './riigikohusAdapter.js';
import { fetchWithRetry } from '../utils/http.js';

export interface RealRiigikohusAdapterOptions {
  indexUrls?: string[];
  http?: typeof fetch;
  logger?: (msg: string) => void;
  limit?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  userAgent?: string;
}

export interface IndexEntry {
  url: string;
  caseNumber?: string;
  date?: string;
  category?: string;
}

export interface RunStats {
  indexEntries: number;
  detailPagesParsed: number;
  canonicalResults: number;
}

const CASE_NUMBER_RE = /\b(\d+-\d+-\d+(?:-\d+-\d+)?(?:\/\d+)?)\b/;
const DATE_DOT_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/;
const DATE_ISO_RE = /(\d{4})-(\d{2})-(\d{2})/;

const pad2 = (n: string): string => (n.length === 1 ? `0${n}` : n);

const EST_MONTHS: Record<string, number> = {
  jaanuar: 1, veebruar: 2, märts: 3, aprill: 4,
  mai: 5, juuni: 6, juuli: 7, august: 8,
  september: 9, oktoober: 10, november: 11, detsember: 12,
};

const parseEstonianDate = (s: string): string | undefined => {
  const normalized = s.replace(/\u00A0/g, ' ');
  const m = normalized.match(
    /(\d{1,2})\.\s*([a-zäöüõšž]+)\s+(\d{4})/i,
  );
  if (m) {
    const day = Number(m[1]);
    const month = EST_MONTHS[m[2].toLowerCase()];
    const year = Number(m[3]);
    if (month && day >= 1 && day <= 31 && year > 1900) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const dm = normalized.match(DATE_DOT_RE);
  if (dm) return `${dm[3]}-${pad2(dm[2])}-${pad2(dm[1])}`;
  return undefined;
};

const deriveRikosUrl = (asjaNr: string): string =>
  `https://rikos.rik.ee/?asjaNr=${asjaNr}`;

export class RealRiigikohusAdapter implements RiigikohusAdapter {
  private indexUrls: string[];
  private http: typeof fetch;
  private log: (msg: string) => void;
  private limit: number;
  private timeoutMs: number;
  private retries: number;
  private backoffMs: number;
  private userAgent: string;

  lastRunStats: RunStats = {
    indexEntries: 0,
    detailPagesParsed: 0,
    canonicalResults: 0,
  };

  constructor(opts: RealRiigikohusAdapterOptions = {}) {
    this.indexUrls = opts.indexUrls ?? [
      'https://www.riigikohus.ee/et/lahendid',
    ];
    this.http = opts.http ?? (globalThis.fetch as typeof fetch);
    this.log = opts.logger ?? ((m) => console.log(`[riigikohus] ${m}`));
    this.limit = opts.limit ?? 0;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.retries = opts.retries ?? 2;
    this.backoffMs = opts.backoffMs ?? 300;
    this.userAgent = opts.userAgent ?? 'riigikohus-watch/1.0';
  }

  async fetch(keywords: string[], _since?: string): Promise<RawCase[]> {
    const keyword = keywords[0] ?? 'majanduskava';

    const allEntries: IndexEntry[] = [];
    for (const url of this.indexUrls) {
      let html: string;
      try {
        html = await this.fetchHtml(url);
      } catch (err) {
        throw new Error(
          `Riigikohus index fetch failed (${url}): ${(err as Error).message}`,
        );
      }
      const entries = this.parseIndex(html, url);
      allEntries.push(...entries);
    }
    this.log(`index entries parsed: ${allEntries.length}`);

    const dedup = new Map<string, IndexEntry>();
    for (const e of allEntries) {
      const key = e.caseNumber ? `cn:${e.caseNumber}` : `url:${e.url}`;
      if (!dedup.has(key)) dedup.set(key, e);
    }
    const limited =
      this.limit > 0
        ? [...dedup.values()].slice(0, this.limit)
        : [...dedup.values()];

    const results: RawCase[] = [];
    let parsed = 0;
    for (const entry of limited) {
      try {
        const html = await this.fetchHtml(entry.url);
        const raw = this.parseDetail(html, entry, keyword);
        if (!raw) {
          this.log(`warn: skipped (missing fields) ${entry.url}`);
          continue;
        }
        results.push(raw);
        parsed += 1;
      } catch (err) {
        this.log(
          `warn: skipped (fetch/parse error) ${entry.url}: ${(err as Error).message}`,
        );
      }
    }
    this.log(`detail pages parsed: ${parsed}`);
    this.log(`canonical results: ${results.length}`);
    this.lastRunStats = {
      indexEntries: allEntries.length,
      detailPagesParsed: parsed,
      canonicalResults: results.length,
    };
    return results;
  }

  async fetchHtml(url: string): Promise<string> {
    return fetchWithRetry(url, {
      http: this.http,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      backoffMs: this.backoffMs,
      userAgent: this.userAgent,
    });
  }

  parseIndex(html: string, baseUrl: string): IndexEntry[] {
    const $ = load(html);
    const entries: IndexEntry[] = [];
    const seenKeys = new Set<string>();

    $('a').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      let asjaNr: string | null = null;
      let absHref: string | null = null;
      try {
        const u = new URL(href, baseUrl);
        asjaNr = u.searchParams.get('asjaNr');
        absHref = u.toString();
      } catch {
        /* relative href without base */
      }

      let caseNumber: string | undefined;
      if (asjaNr) {
        const cm = asjaNr.match(CASE_NUMBER_RE);
        if (cm) caseNumber = cm[1];
      }
      if (!caseNumber) {
        const linkText = $(el).text().replace(/\u00A0/g, ' ').trim();
        const m = linkText.match(CASE_NUMBER_RE) ?? href.match(CASE_NUMBER_RE);
        if (m) caseNumber = m[1];
      }
      if (!caseNumber) return;

      const linkText = $(el).text().replace(/\u00A0/g, ' ').trim();
      let dMatch = linkText.match(DATE_DOT_RE);
      let $ctx = $(el);
      if (!dMatch) {
        $ctx = $(el).closest(
          'li, tr, article, div.decision, .lahend-item, .search-result',
        );
        const ctxText = ($ctx.length > 0 ? $ctx.text() : linkText).replace(
          /\u00A0/g,
          ' ',
        );
        dMatch = ctxText.match(DATE_DOT_RE);
      }
      const date = dMatch
        ? `${dMatch[3]}-${pad2(dMatch[2])}-${pad2(dMatch[1])}`
        : undefined;

      const categoryEl = $ctx.find('.category, .kolleegium').first();
      const category = categoryEl.text().trim() || undefined;

      const detailUrl = asjaNr ? deriveRikosUrl(asjaNr) : absHref ?? href;
      const key = `cn:${caseNumber}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      entries.push({ url: detailUrl, caseNumber, date, category });
    });

    return entries;
  }

  parseDetail(
    html: string,
    entry: IndexEntry,
    keyword: string,
  ): RawCase | null {
    const $ = load(html);

    // --- caseNumber fallbackid ---
    // A1: URL asjaNr query param
    let caseNumber: string | undefined;
    try {
      const asjaNr = new URL(entry.url).searchParams.get('asjaNr');
      if (asjaNr) {
        const m = asjaNr.match(CASE_NUMBER_RE);
        if (m) caseNumber = m[1];
      }
    } catch {
      /* ignore malformed url */
    }
    // A2: headings + <title>
    if (!caseNumber) {
      const headingSources = [
        $('h1, h2, .title, .page-title')
          .map((_i, el) => $(el).text().trim())
          .get()
          .join(' '),
        $('title').text().trim(),
      ]
        .filter(Boolean)
        .join(' ');
      const cnMatch = headingSources.match(CASE_NUMBER_RE);
      if (cnMatch) caseNumber = cnMatch[1];
    }
    // A3: kogu body tekst regexiga
    if (!caseNumber) {
      const bodyMatch = $('body').text().match(CASE_NUMBER_RE);
      if (bodyMatch) caseNumber = bodyMatch[1];
    }
    if (!caseNumber) return null;

    // --- date fallbackid ---
    let date: string | undefined;
    // C1: Otsuse kuupäev label <b>/<strong> → järgmine td
    $('b, strong').each((_i, el) => {
      if (date) return;
      const label = $(el).text().trim();
      if (!/otsuse\s+kuup[äa]ev/i.test(label)) return;
      const $td = $(el).closest('td');
      const $next = $td.next('td');
      const value = ($next.length > 0 ? $next.text() : $(el).parent().text())
        .replace(/\u00A0/g, ' ');
      const parsed = parseEstonianDate(value);
      if (parsed) date = parsed;
    });
    // C2: meta-tag
    if (!date) {
      const metaDate =
        $('meta[property="article:published_time"]').attr('content') ??
        $('meta[name="date"]').attr('content') ??
        $('time[datetime]').first().attr('datetime');
      if (metaDate) {
        const m = metaDate.match(DATE_ISO_RE);
        if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
      }
    }
    // C3a: "Otsuse kuupäev: ..." üldtekstist (kui label polnud bold-is)
    if (!date) {
      const fullText = $.root().text().replace(/\u00A0/g, ' ');
      const label = fullText.match(
        /otsuse\s+kuup[äa]ev[:\s]+([^\n]{1,60})/i,
      );
      if (label) date = parseEstonianDate(label[1]);
    }
    // C3b: Eesti kuu-nimi / DD.MM.YYYY üldtekstist
    if (!date) {
      const fullText = $.root().text().replace(/\u00A0/g, ' ');
      date = parseEstonianDate(fullText);
    }
    // C3c: ISO YYYY-MM-DD üldtekstist
    if (!date) {
      const iso = $.root().text().match(DATE_ISO_RE);
      if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    if (!date) date = entry.date;
    if (!date) return null;

    // --- title fallbackid ---
    const escCn = caseNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripCnPrefix = (s: string): string => {
      const t = s.trim();
      if (!t || t === caseNumber) return '';
      return t.replace(new RegExp(`^${escCn}\\s*[—–-]\\s*`), '').trim();
    };
    // B1: esimene sisuline heading
    let title = '';
    for (const h of $('h1, h2, .title, .page-title')
      .map((_i, el) => $(el).text().trim())
      .get()) {
      const cleaned = stripCnPrefix(h);
      if (cleaned) {
        title = cleaned;
        break;
      }
    }
    // B2: <title> ilma case-numbri prefiksita
    if (!title) title = stripCnPrefix($('title').text());
    // B3: esimene tugev bold/strong päis body sees
    if (!title) {
      title = $('p b, p strong, b, strong')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (!title) return null;

    // --- bodyText fallbackid ---
    const MIN_BODY_LEN = 50;
    const BODY_SELECTORS = [
      '.WordSection1',
      'article',
      '.content',
      '.entry-content',
      '.field-item',
      'body',
    ];
    let bodyText = '';
    for (const sel of BODY_SELECTORS) {
      const t = $(sel).first().text().replace(/\s+/g, ' ').trim();
      if (t.length > bodyText.length) bodyText = t;
      if (bodyText.length >= MIN_BODY_LEN) break;
    }
    if (bodyText.length < MIN_BODY_LEN) {
      const coalesced = $('main, table, td, p, div')
        .map((_i, el) => $(el).text())
        .get()
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (coalesced.length > bodyText.length) bodyText = coalesced;
    }
    if (!bodyText) return null;

    return {
      caseNumber,
      date,
      keyword,
      text: `${title}\n\n${bodyText}`,
      citations: [{ caseNumber, points: '' }],
    };
  }
}
