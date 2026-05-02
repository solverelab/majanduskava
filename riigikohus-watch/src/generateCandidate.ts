import type { Candidate, RawCase, Topic } from './types.js';

const TOPIC_KEYWORDS: Record<Topic, string[]> = {
  koostamine: ['koostamine', 'eelnõu'],
  kutse: ['kutse', 'kokkukutsumise kord', 'kokkukutsumine'],
  materjalid: ['kättesaadav', 'materjal'],
  haaletamine: ['kirjalik hääletamine', 'hääletamine', 'hääletus'],
  kvoorum: ['kvoorum', 'esindus', 'volikiri'],
  protokoll: ['hääletusprotokoll', 'protokoll'],
  kinnitamine: ['kinnitamine', 'kinnitab', 'kinnitama'],
  vaidlustamine: ['otsuse tühisus', 'kehtetuks tunnistamine', 'vaidlustamine'],
  kulude_jaotus: ['kulude jaotus', 'majandamiskulud', 'krts § 40', 'krts 40'],
};

const TOPIC_ORDER: Topic[] = [
  'kinnitamine',
  'vaidlustamine',
  'haaletamine',
  'kvoorum',
  'protokoll',
  'kutse',
  'materjalid',
  'koostamine',
  'kulude_jaotus',
];

export const detectTopic = (text: string): Topic | null => {
  const lc = text.toLowerCase();
  for (const topic of TOPIC_ORDER) {
    const hit = TOPIC_KEYWORDS[topic].some((w) => lc.includes(w.toLowerCase()));
    if (hit) return topic;
  }
  return null;
};

const KOS_KYS_STRONG = [
  /korteriomandiseadus/i,
  /korteriomandi\s+seadus/i,
  /korteriühistuseadus/i,
  /korteriühistu\s+seadus/i,
];

const KOS_KYS_ABBREV = [/\bKOS\b/, /\bKÜS\b/];

const KRTS_MARKERS = [
  /\bKrtS\b/,
  /korteriomandi-\s*ja\s*korteriühistuseadus/i,
];

export const isKrtsEra = (raw: RawCase): boolean => {
  if (raw.era) return raw.era === 'KrtS';
  const isKrts = KRTS_MARKERS.some((p) => p.test(raw.text));
  if (isKrts) return true;
  const isOld =
    KOS_KYS_STRONG.some((p) => p.test(raw.text)) ||
    KOS_KYS_ABBREV.some((p) => p.test(raw.text));
  if (isOld) return false;
  return true;
};

const TOPIC_MARKERS: RegExp[] = [
  /majanduskava/i,
  /majandamiskulu/i,
  /kulude\s*jaotus/i,
  /reservkapital/i,
  /remondifond/i,
  /remondikapital/i,
  /üldkoosoleku\s*kutse/i,
  /kokkukutsumise\s*kord/i,
  /kirjalik\s*hääletamine/i,
  /hääletusprotokoll/i,
  /protokoll/i,
  /kvoorum/i,
  /volikiri/i,
  /esindusõigus/i,
  /otsuse\s*tühisus/i,
  /kehtetuks\s+tunnistamine/i,
];

const CONTEXT_ANCHORS: RegExp[] = [
  /korteriühistu/i,
  /korteriomanik/i,
  /\bKrtS\b/,
  /majandamiskulude\s+kandmine/i,
  /korteriomandi-\s*ja\s*korteriühistu\s*seadus/i,
];

export const hasTopicMarker = (text: string): boolean =>
  TOPIC_MARKERS.some((re) => re.test(text));

export const hasContextAnchor = (text: string): boolean =>
  CONTEXT_ANCHORS.some((re) => re.test(text));

export const isRelevant = (raw: RawCase): boolean => {
  if (!isKrtsEra(raw)) return false;
  if (!hasTopicMarker(raw.text)) return false;
  if (!hasContextAnchor(raw.text)) return false;
  return true;
};

export const makeCandidate = (raw: RawCase, id: string): Candidate | null => {
  if (!isRelevant(raw)) return null;
  const topic = detectTopic(raw.text);
  if (!topic) return null;
  const bullet =
    raw.proposedBullet?.trim() ||
    `Lahendis ${raw.caseNumber} käsitletakse teemat "${topic}".`;
  const citations =
    raw.citations && raw.citations.length > 0
      ? raw.citations
      : [{ caseNumber: raw.caseNumber, points: '' }];
  return {
    id,
    caseNumber: raw.caseNumber,
    date: raw.date,
    keyword: raw.keyword,
    topic,
    candidateBullet: bullet,
    citations,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
};
