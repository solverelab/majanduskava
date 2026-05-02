import type { Candidate } from '../types.js';
import { readJson } from '../utils/io.js';
import { PATHS } from '../utils/paths.js';

async function main(): Promise<void> {
  const pending = await readJson<Candidate[]>(PATHS.pending, []);
  if (pending.length === 0) {
    console.log('Pending kandidaate ei ole.');
    return;
  }
  console.log(`Pending kandidaate: ${pending.length}`);
  for (const c of pending) {
    const cites = c.citations
      .map((x) => `${x.caseNumber}${x.points ? ` p ${x.points}` : ''}`)
      .join('; ');
    console.log('');
    console.log(`${c.id}  ${c.caseNumber}  ${c.date}  [${c.topic}]`);
    console.log(`  märksõna: ${c.keyword}`);
    console.log(`  viide:    ${cites}`);
    console.log(`  bullet:   ${c.candidateBullet}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
