# AGENTS.md

## Project goal

Build the majanduskava calculation engine and final document logic so that calculation is canonical, data flow is coherent, KrtS § 41 p 1–p 5 structure is always preserved, and critical logic is covered by tests.

## Core rules

- Prefer canonical computation over derived values.
- Preserve existing model split: computePlan vs computeRemondifondiArvutus.
- UI, render and print must not re-calculate business logic if the same result belongs in compute layer.
- Derived values may be used only for presentation, not as a new source of truth.
- Do not refactor unrelated code.
- Make minimal, testable changes.
- If a legal/business rule changes, add or update tests.

## Legal/business invariants

- Final document must always render KrtS § 41 p 1–p 5 blocks.
- Conditional logic may affect only content inside a block, not whether the block exists.
- p 2 and p 5 must stay separate.
- Do not double-count consumption-based utilities between p 2 and p 5.
- p 3 default allocation basis is kaasomandi osa / m².
- Exceptions to m² allocation must have distinct legal basis: põhikiri, kokkulepe, or actual consumption.
- Reserve capital check must use expected annual costs and refer to KrtS § 48.
- Loan principal/use is not income.
- Loans belong in separate financing/liability logic.
- Interest and fees are costs.
- Funds belong in p 4, ordinary costs in p 2, utilities in p 5.

## Required workflow

Before changing code:
- Identify the canonical compute source.
- Check whether the change affects p 1–p 5 structure.
- Avoid moving business logic into UI, render or print.

Before finishing:
- Run tests if available.
- Report any missing script instead of inventing commands.

## Commands

Use only commands that exist in package.json.

Common checks:
- npm test
- npm run lint
- npm run typecheck
