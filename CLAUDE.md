# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Majanduskava is a financial planning and risk assessment app for Estonian apartment associations (korteriühistud), built on the Solvere policy evaluation framework. The UI and domain language are Estonian. It helps managers create multi-year financial plans with intelligent suggestions for balancing budgets, managing loans, and monitoring risk.

## Commands

```bash
npm run dev       # Start Vite dev server (localhost:5173)
npm run build     # Production build to dist/
npm run preview   # Preview production build
npm run deploy    # Deploy to GitHub Pages via gh-pages
npx vitest        # Run tests (vitest, not in package.json scripts)
npx vitest run src/policy/__tests__/autoResolve.test.ts  # Run single test file
```

No test script is defined in package.json — use `npx vitest` directly. Test files live in `src/policy/__tests__/`.

## Architecture

### Three-Layer Design

```
React UI (src/MajanduskavaApp.jsx)
    ↓ plan state
Solvere Framework (packages/solvere-core/)
    ↓ orchestrates
Majanduskava Module (solvere-modules/majanduskava/ + src/engine/ + src/policy/)
```

### Core Data Flow

1. User edits plan in UI → React state update
2. `computePlan(state)` (src/engine/computePlan.js) calculates financial metrics: loan schedules, cashflow, repair fund balances, risk metrics
3. `evaluatePolicy(state, metrics)` generates findings (issues) against preset thresholds
4. `compileRemedies(findings, state, metrics)` attaches corrective actions to each finding
5. `withActionImpacts()` simulates each action to compute risk score deltas
6. UI renders findings with actionable fix buttons; "Solve All" runs `autoResolve` loop (up to 10 steps)

### Key Abstractions

- **Plan State**: Full financial plan data (apartments, costs, incomes, investments, funds, loans) — schema factories in `src/domain/planSchema.js`
- **Metrics**: Computed financial figures (fund balances, monthly costs, loan burden) — types in `solvere-modules/majanduskava/src/types.ts`
- **Findings**: Policy violations with severity (error/warning/info) and attached actions — codes: `RF_NEG`, `RESERVE_LOW`, `LOAN_WARN`, `LOAN_ERROR`, `OWNERS_WARN`, `OWNERS_ERROR`
- **Actions**: JSON patches (set/increment/decrement on dot-path like `funds.repairFund.monthlyRateEurPerM2`) that fix findings
- **Presets**: YAML-defined policy configurations (BALANCED, CONSERVATIVE, LOAN_FRIENDLY) with different threshold values — `src/policy/majanduskava-policy.v1.yaml`

### Module Structure

- **`packages/solvere-core/`** — Framework: moduleHost orchestrator, applyPatch engine, autoResolve loop, risk evaluation, registry. Published as `@solvere/core`.
- **`solvere-modules/majanduskava/`** — Domain module: runtime factory, policy loader, finding evaluator, remedy compiler, manifest.
- **`src/engine/computePlan.js`** — Pure financial computation (loan annuity formulas, cashflow aggregation, fund balances).
- **`src/policy/`** — Policy YAML, legacy policy engine, runtime, and all tests.
- **`src/solvereBridge/`** — Bridge connecting solvere-core host to the React UI.
- **`src/MajanduskavaApp.jsx`** — Monolithic main component (~41KB) containing all UI sections and local React state (no external state management).

### State Management

All state is local React `useState` in MajanduskavaApp.jsx — no Redux, Context, or external state library. Immutable updates via spread operator.

## Tech Stack

- React 19 + Vite 7 (SPA)
- TailwindCSS 4 for styling
- TypeScript for policy engine and modules (strict: false), JSX files for UI
- YAML for policy definitions (parsed with `yaml` package)
- Vitest for testing
- gh-pages for deployment

## Conventions

- Financial computations must be pure functions with no side effects (deterministic for same inputs)
- Actions are declarative JSON patches, not imperative mutations
- Policy rules are defined in YAML, not hardcoded in logic
- All user-facing text is in Estonian

## Õiguslik raamistik (KrtS)

- **Reservkapital**: minimaalselt 1/12 aastakuludest (KrtS § 8), katab kõiki kulusid
- **Remondifond**: pikaajalised suuremad tööd, kogumisperiood planeeritud üle kava perioodi
- **Laenu tingimuslikkus**: kui laen pole kinnitatud, on see "taotlusel" ja omanike maksed peavad toimima ka ilma laenuta (KrtS § 41)
- **Juriidiline kaitseklausel**: kava peab sisaldama selgitust, et omanike kohustused ei muutu kui laenu ei saada
