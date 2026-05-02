import type { Candidate } from './types.js';

export interface RunSummary {
  adapter: string;
  indexEntriesParsed: number | null;
  detailPagesParsed: number | null;
  canonicalResults: number | null;
  candidatesCreated: number;
  duplicatesSkipped: number;
  newCandidateIds: string[];
  generatedAt: string;
}

const statLine = (label: string, v: number | null): string =>
  `- ${label}: ${v === null ? '—' : v}`;

const formatCitations = (c: Candidate): string =>
  c.citations
    .map((x) => (x.points ? `${x.caseNumber}, p ${x.points}` : x.caseNumber))
    .join('; ');

export const buildReport = (
  summary: RunSummary,
  pending: Candidate[],
): string => {
  const newSet = new Set(summary.newCandidateIds);
  const newCandidates = pending.filter((c) => newSet.has(c.id));

  const lines: string[] = [];
  lines.push('# Riigikohtu watch report');
  lines.push('');
  lines.push(`- Adapter: ${summary.adapter}`);
  lines.push(statLine('Index entries parsed', summary.indexEntriesParsed));
  lines.push(statLine('Detail pages parsed', summary.detailPagesParsed));
  lines.push(statLine('Canonical results', summary.canonicalResults));
  lines.push(`- Candidates created: ${summary.candidatesCreated}`);
  lines.push(`- Duplicates skipped: ${summary.duplicatesSkipped}`);
  lines.push('');

  if (newCandidates.length === 0) {
    lines.push('## Tulemus');
    lines.push('Uusi pending kandidaate ei tekkinud.');
  } else {
    lines.push('## Uued pending kandidaadid');
    lines.push('');
    for (const c of newCandidates) {
      lines.push(`### ${c.id}`);
      lines.push(`- Lahend: ${c.caseNumber}`);
      lines.push(`- Teema: ${c.topic}`);
      lines.push(`- Bullet: ${c.candidateBullet}`);
      const cites = formatCitations(c);
      if (cites) lines.push(`- Viited: ${cites}`);
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
};
