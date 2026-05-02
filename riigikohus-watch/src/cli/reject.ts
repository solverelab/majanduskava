import type { ApprovedRule, Candidate } from '../types.js';
import { readJson, writeJson } from '../utils/io.js';
import { PATHS } from '../utils/paths.js';
import { reject } from '../reviewCandidate.js';
import { requireArg } from '../utils/args.js';

async function main(): Promise<void> {
  const id = requireArg('id');
  const pending = await readJson<Candidate[]>(PATHS.pending, []);
  const approved = await readJson<ApprovedRule[]>(PATHS.approved, []);
  const next = reject(id, { pending, approved });
  await writeJson(PATHS.pending, next.pending);
  console.log(`Tagasi lükatud: ${id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
