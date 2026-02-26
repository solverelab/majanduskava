// scripts/solvere-smoke-test.mjs
// Run: npx tsx scripts/solvere-smoke-test.mjs

import fs from "node:fs";
import { createModuleHost } from "../packages/solvere-core/src/moduleHost.ts";
import { createMajanduskavaRuntime } from "../solvere-modules/majanduskava/src/runtime.ts";

const runtime = createMajanduskavaRuntime();
const host = createModuleHost({ module: runtime, preset: "BALANCED" });

const plan = JSON.parse(
  fs.readFileSync(new URL("./plan-fixture.json", import.meta.url), "utf-8")
);

let res = host.run(plan);
console.log("\n=== INITIAL EVALUATION ===");
printEval(res.evaluation);

const f = res.evaluation.findings.find((x) => (x.actions?.length ?? 0) > 0);
if (!f) { console.log("\nNo findings with actions."); process.exit(0); }

const action = f.actions[0];
console.log(`\n=== APPLY ACTION: ${action.code} — ${action.label} ===`);
res = host.applyActionAndRun(res.state, action);
console.log("\n=== AFTER APPLY ===");
printEval(res.evaluation);

function printEval(evaluation) {
  console.log("hasErrors:", evaluation.hasErrors);
  for (const finding of evaluation.findings) {
    const count = finding.actions?.length ?? 0;
    console.log(`- [${finding.severity}] ${finding.code}: ${finding.title} (actions: ${count})`);
    if (count) {
      for (const a of finding.actions) {
        console.log(`    • ${a.label} | ${a.patch.map((p) => `${p.op} ${p.path}=${p.value}`).join("; ")}`);
      }
    }
  }
}
