import type { ApprovedRule, Candidate, RawCase } from '../types.js';
import { readJson, writeJson } from '../utils/io.js';
import { PATHS } from '../utils/paths.js';
import { selectAdapter } from '../adapters/selectAdapter.js';
import { RealRiigikohusAdapter } from '../adapters/RealRiigikohusAdapter.js';
import { runCheck, type SkippedEntry } from '../checkRiigikohus.js';

const DUP_REASONS: ReadonlySet<SkippedEntry['reason']> = new Set([
  'already seen',
  'pending duplicate',
  'content duplicate of approved rule',
]);

async function main(): Promise<void> {
  const keywords = await readJson<string[]>(PATHS.keywords, []);
  const seen = await readJson<string[]>(PATHS.seen, []);
  const pending = await readJson<Candidate[]>(PATHS.pending, []);
  const approved = await readJson<ApprovedRule[]>(PATHS.approved, []);
  const mock = await readJson<RawCase[]>(PATHS.mockCases, []);

  const { adapter, choice } = selectAdapter({ stubFixtures: mock });
  console.log(`Adapter: ${choice}`);
  if (choice === 'stub' && mock.length === 0) {
    console.log(
      'Märkus: _mock_cases.json on tühi. Stub-adapter tagastab tühja tulemuse.',
    );
  }

  const result = await runCheck({ keywords, seen, pending, approved, adapter });

  const newPending = [...pending, ...result.newCandidates];
  await writeJson(PATHS.pending, newPending);
  await writeJson(PATHS.seen, result.updatedSeen);

  console.log(`Uusi kandidaate: ${result.newCandidates.length}`);
  for (const c of result.newCandidates) {
    console.log(`  ${c.id}  ${c.caseNumber}  [${c.topic}]`);
    console.log(`    → ${c.candidateBullet}`);
  }
  if (result.skipped.length > 0) {
    console.log(`Vahele jäetud: ${result.skipped.length}`);
    for (const s of result.skipped) {
      console.log(`  ${s.caseNumber}  (${s.reason})`);
    }
  }

  const duplicatesSkipped = result.skipped.filter((s) =>
    DUP_REASONS.has(s.reason),
  ).length;
  const summary: Array<[string, string | number]> = [
    ['Adapter', choice],
  ];
  if (adapter instanceof RealRiigikohusAdapter) {
    const s = adapter.lastRunStats;
    summary.push(['index entries parsed', s.indexEntries]);
    summary.push(['detail pages parsed', s.detailPagesParsed]);
    summary.push(['canonical results', s.canonicalResults]);
  }
  summary.push(['candidates created', result.newCandidates.length]);
  summary.push(['duplicates skipped', duplicatesSkipped]);

  const width = Math.max(...summary.map(([k]) => k.length));
  console.log('');
  console.log('=== Dry-run ===');
  for (const [k, v] of summary) {
    console.log(`${k.padEnd(width, ' ')}  ${v}`);
  }
  console.log('================');

  const stats = adapter instanceof RealRiigikohusAdapter
    ? adapter.lastRunStats
    : null;
  await writeJson(PATHS.lastSummary, {
    adapter: choice,
    indexEntriesParsed: stats ? stats.indexEntries : null,
    detailPagesParsed: stats ? stats.detailPagesParsed : null,
    canonicalResults: stats ? stats.canonicalResults : null,
    candidatesCreated: result.newCandidates.length,
    duplicatesSkipped,
    newCandidateIds: result.newCandidates.map((c) => c.id),
    generatedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
