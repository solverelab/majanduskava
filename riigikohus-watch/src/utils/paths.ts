import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

export const PATHS = {
  keywords: path.join(ROOT, 'config', 'keywords.json'),
  seen: path.join(ROOT, 'data', 'seen_cases.json'),
  pending: path.join(ROOT, 'data', 'pending_candidates.json'),
  approved: path.join(ROOT, 'data', 'approved_bullets.json'),
  mockCases: path.join(ROOT, 'data', '_mock_cases.json'),
  lastSummary: path.join(ROOT, 'data', 'last_run_summary.json'),
  report: path.join(ROOT, 'data', 'report.md'),
};
