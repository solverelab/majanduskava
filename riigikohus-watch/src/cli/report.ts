import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Candidate } from '../types.js';
import { readJson } from '../utils/io.js';
import { PATHS } from '../utils/paths.js';
import { buildReport, type RunSummary } from '../reportPending.js';

async function main(): Promise<void> {
  const summary = await readJson<RunSummary | null>(PATHS.lastSummary, null);
  if (!summary) {
    console.error(
      `last_run_summary.json puudub: ${PATHS.lastSummary}\n` +
        `Käivita esmalt "npm run check", mis kirjutab kokkuvõtte.`,
    );
    process.exit(1);
  }
  const pending = await readJson<Candidate[]>(PATHS.pending, []);
  const md = buildReport(summary, pending);
  await fs.mkdir(path.dirname(PATHS.report), { recursive: true });
  await fs.writeFile(PATHS.report, md, 'utf-8');
  console.log(`Report: ${PATHS.report}`);
  console.log(`  candidates created: ${summary.candidatesCreated}`);
  console.log(`  new in this run:    ${summary.newCandidateIds.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
