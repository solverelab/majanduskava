# Investment Planning Logic — Formal Specification

Documents the current deterministic behavior of investment scheduling
and funding allocation as implemented in `computePlan.js` and
`computeRemondifondiArvutus` (majanduskavaCalc.js). This is a
description of existing code, not a design proposal.

---

## 1. Investment selection: thisYearItems

```
Source:     plan.investments.items (canonical array, insertion order)
Filter:     it.plannedYear === period.year
Result:     thisYearItems — all investments scheduled for the plan year
```

**No status filtering.** DRAFT, READY, and BLOCKED investments all
enter `thisYearItems`. This is deliberate — outflow calculations must
include all items regardless of structural validity.

A second filtered set exists for recommendations only:

```
readyThisYear = thisYearItems
  .filter(isInvestmentReady)          // only READY
  .sort(compareInvestmentsCanonical)  // plannedYear ASC, totalCostEUR DESC, name ASC
```

`readyThisYear` feeds `thisYearCount` and the validation loop.
`thisYearItems` feeds cost/outflow calculations.

---

## 2. Processing order

### 2a. Outflow calculations (computePlan.js L167–177)

`thisYearItems` is processed via `.reduce()` — **order-independent**.
Each investment contributes independently to three outflow sums:

```
rfOutflowThisYearEUR      = sum of fundingPlan entries where source === "REPAIR_FUND"
reserveOutflowThisYearEUR = sum of fundingPlan entries where source === "RESERVE"
loanOutflowThisYearEUR    = sum of fundingPlan entries where source === "LOAN"
```

These are commutative sums. Processing order does not affect the result.

### 2b. Recommendation loop (computePlan.js L284)

`readyThisYear` is iterated in **canonical order** (plannedYear ASC,
totalCostEUR DESC, name ASC). The loop produces findings
(INV_UNDER, INV_OVER, INV_LOAN_*) in this order. The order affects
finding display sequence but not finding content — each investment is
evaluated independently.

### 2c. Remondifondi detail allocation (majanduskavaCalc.js L169–190)

`invDetail` is sorted by **aasta ASC** (L181). Then saldo allocation
is applied sequentially:

```
for each investment (sorted by year ASC):
  saldost    = min(remaining_saldo, rfSumma)   // cover from opening balance
  remaining -= saldost
  koguda     = rfSumma - saldost                // amount still to collect
  aastasKoguda = koguda / kogumisaastad         // annual collection rate
```

**This is ORDER-DEPENDENT.** Earlier-year investments consume opening
balance first. Two investments in the same year are in insertion order
(sort is stable, no secondary key). The annual rate `maarAastasM2`
depends on which investments received saldo coverage.

---

## 3. Funding source → outflow mapping

### 3a. computePlan.js (Tee 1 — simplified closings)

| fundingPlan.source | Outflow field | Used in |
|--------------------|---------------|---------|
| `"REPAIR_FUND"` | `rfOutflowThisYearEUR` | `repairFundClosingEUR` = opening + income - rfOutflow |
| `"RESERVE"` | `reserveOutflowThisYearEUR` | `reserveClosingEUR` = opening + planned - reserveOutflow |
| `"LOAN"` | `loanOutflowThisYearEUR` | Exposed in output, not used in closing balance |
| Any other source | Not captured | Silently ignored in outflow calculations |

### 3b. majanduskavaCalc.js (UI-layer remondifondi)

| fundingPlan.source | What it feeds | Notes |
|--------------------|---------------|-------|
| `"Remondifond"` | `investRemondifondist`, `invDetail`, `maarAastasM2` | Drives repair fund rate calculation |
| `"Laen"` | `isConditional`, `sumLaen`, `onLaen`, scenario split | Controls whether investment is "conditional" |
| `"Toetus"`, `"Sihtmakse"` | Not captured | Silently ignored in RF calculation |

**Note the source name mismatch:** computePlan.js uses English enum
values (`"REPAIR_FUND"`, `"RESERVE"`, `"LOAN"`). majanduskavaCalc.js
uses Estonian UI strings (`"Remondifond"`, `"Laen"`). These are two
separate systems operating on the same `fundingPlan` array with
different source vocabularies. See section 8 for the full vocabulary
spec.

---

## 4. Closing balance formulas

```
repairFundClosingEUR = repairFundOpeningEUR
                     + repairFundIncomePeriodEUR     (rfRate × totAreaM2 × monthEq)
                     - rfOutflowThisYearEUR          (sum of REPAIR_FUND funding)

reserveClosingEUR    = reserveOpeningEUR
                     + reservePlannedEUR              (user-entered planned reserve)
                     - reserveOutflowThisYearEUR     (sum of RESERVE funding)
```

If closing < 0, a shortfall finding is generated (RF_NEG, RES_NEG).
The shortfall amount drives the suggested rate increase
(`rfSuggestedMonthlyRateEurPerM2`).

---

## 5. "Katmata osa" (unfunded portion)

### CANONICAL DEFINITION

The canonical unfunded portion of a single investment is:

```
realRows = fundingPlan.filter(fp => (fp.source || "").trim() !== "")
kaetud   = realRows.reduce((s, fp) => s + (fp.amountEUR || 0), 0)
katmata  = totalCostEUR - kaetud
```

Rules:
- Only **real rows** count — rows where `(source || "").trim() !== ""`
- Empty-source placeholders (`{ source: "", amountEUR: 0 }`) are excluded
- Whitespace-only sources (`{ source: "   ", ... }`) are excluded
- `katmata > 0` means underfunded
- `katmata === 0` means fully funded
- `katmata < 0` means overfunded (BLOCKED by investmentStatus)

This definition is used in:
- **UI coverage display** (MajanduskavaApp.jsx L1942–1945, L2031–2034)
- **Aggregate summary** (MajanduskavaApp.jsx L2058) — applied
  per-investment then summed across counted (READY + BLOCKED) items
- **investmentStatus** (majanduskavaCalc.js L11–12) — same real-row
  filter determines whether an investment is DRAFT, READY, or BLOCKED

If extracted to a shared util, the canonical signature would be:

```js
function computeKatmataOsa(inv) {
  const realRows = (inv.fundingPlan || []).filter(fp => (fp.source || "").trim() !== "");
  const kaetud = realRows.reduce((s, fp) => s + (fp.amountEUR || 0), 0);
  const katmata = (inv.totalCostEUR || 0) - kaetud;
  return { kaetud, katmata, realRows };
}
```

### NON-CANONICAL: computePlan.js recommendation loop (L288)

```
funded = sum of ALL fundingPlan amountEUR (no source filtering)
```

**Difference from canonical:** does NOT filter out empty-source
placeholder rows. Includes `{ source: "", amountEUR: 0 }` in the sum.

**Why it still works:** In practice, placeholder rows always have
`amountEUR: 0` (the UI disables amount input until a source is
selected). So the sum equals the canonical `kaetud` for any
real-world data. The difference is only observable if a placeholder
row somehow gets a non-zero amount — which the UI prevents.

**Verdict:** Functionally equivalent under current UI constraints.
Not a bug, but not aligned with the canonical trim rule. If extracted
to a shared util, this call site should switch to the canonical
definition.

### NON-CANONICAL: remondifondi saldo allocation (majanduskavaCalc.js L163–167)

```
investRemondifondist = sum of fundingPlan entries where source === "Remondifond"
```

**Difference from canonical:** filters by specific source value
(`"Remondifond"`), not by the real-row trim rule. This is not
computing "katmata osa" — it is computing how much of the investment
is funded from the repair fund specifically.

**Verdict:** Different purpose. This is a **per-source extraction**,
not a coverage calculation. Not a candidate for the canonical
`computeKatmataOsa` util.

### NON-CANONICAL: fund closing shortfall (computePlan.js L222)

```
rfShortfallEUR = repairFundClosingEUR < 0 ? abs(repairFundClosingEUR) : 0
```

**Difference from canonical:** this is a **fund-level** shortfall
(entire repair fund goes negative), not a per-investment coverage
gap. It is computed from the closing balance formula, not from
individual investment fundingPlans.

**Verdict:** Different concept entirely. Not "katmata osa" despite
the semantic similarity. Should not be unified with the per-investment
canonical definition.

### NON-CANONICAL: cashflow "puudujääk" (MajanduskavaApp.jsx L3037, L3083)

```
vahePeriood = tuludPeriood - valjaminekudPeriood
```

Displayed as "Ülejääk" or "Puudujääk" in the cashflow summary.

**Difference from canonical:** this is a **plan-level cashflow
deficit** — total period income minus total period expenditure.
Not related to individual investment funding coverage.

**Verdict:** Completely different domain. Uses the word "puudujääk"
but measures operational balance, not investment coverage.

---

## 6. Implicit assumptions

1. **Single-year model (design rule).** `computePlan.js` closing
   balances are a single-period snapshot. `thisYearItems` filters by
   exact `plannedYear === period.year` match. Investments with future
   `plannedYear` (year+1, year+2, year+3) do not produce outflows
   and do not affect `repairFundClosingEUR` or `reserveClosingEUR`.
   This is deliberate — the RF rate from `computeRemondifondiArvutus`
   already accounts for future obligations via time-spreading
   (`kogumisaastad`). Locked by regression test.

2. **No funding order priority.** All funding sources are summed
   without priority. If an investment has both REPAIR_FUND and LOAN
   funding, both contribute to their respective outflows
   simultaneously — there is no "use fund first, then loan" logic.

3. **No cross-investment balancing.** Each investment's outflow is
   independent. If total rfOutflow exceeds the repair fund balance,
   the system reports a negative closing balance (RF_NEG) but does
   not reallocate among investments.

4. **fundingPlan amountEUR can exceed totalCostEUR.** No enforcement
   at the calculation layer — the overshoot flows into outflows. The
   UI and investmentStatus flag this as BLOCKED, but the calculation
   proceeds with the overfunded amount.

5. **DRAFT investments contribute zero by math, not by filter.** A
   DRAFT with totalCostEUR=0 and empty fundingPlan adds 0 to every
   sum. This is functionally equivalent to exclusion but achieved
   differently — important for the outflow regression guarantee.

---

## 7. Remondifondi per-investment detail: canonical output or UI explanation?

### Where per-investment detail appears

`computeRemondifondiArvutus` returns two per-investment arrays:

| Field | Content | Returned at |
|-------|---------|-------------|
| `invDetail` | `{ nimetus, rfSumma, aasta, kogumisaastad }` | L238 |
| `invArvutusread` | invDetail + `{ saldost, koguda, aastasKoguda }` | L238 |

These are consumed in the following places:

| Location | What is used | Purpose |
|----------|-------------|---------|
| `MajanduskavaApp.jsx:2380–2421` | `invArvutusread` per-row: nimetus, aasta, rfSumma, koguda/aastasKoguda, + "Kindel/Tingimuslik" badge | Interactive RF detail table (Tab 4) |
| `MajanduskavaApp.jsx:2416–2420` | `invArvutusread.reduce(sum aastasKoguda)` | Footer "Kokku" row in same table |
| `MajanduskavaApp.jsx:2434–2437` | `invArvutusread.reduce(sum aastasKoguda)` | "Kogumisvajadus" summary line |
| `MajanduskavaApp.jsx:2473` | `invDetail.length > 1` | Toggle visibility for kogumisViis selector |
| `MajanduskavaApp.jsx:2573–2595` | `invArvutusread` per-row: nimetus, rfSumma, saldost, koguda, kogumisaastad, aastasKoguda | "Kronoloogiline saldo jaotus" detail panel |
| Print section (L3645–3682) | **Not used** | Print "Fondid ja laen" shows only aggregate RF rate and loan table — no per-investment RF detail |

### Which values affect the plan

| Value | Feeds aggregate? | Affects maarAastasM2? | In print output? |
|-------|-----------------|----------------------|-----------------|
| `invArvutusread[].saldost` | No — only in detail UI | No — sum(saldost) + sum(koguda) = sum(rfSumma), aggregate unchanged | No |
| `invArvutusread[].koguda` | Indirectly via sum | Yes — totalKoguda feeds "uhine" mode | No |
| `invArvutusread[].aastasKoguda` | Yes — totalAastaVajadus feeds "eraldi" mode | Yes | No |
| `sum(aastasKoguda)` | Yes | Yes — becomes maarIlmaLaenuta / maarAastasM2 | Yes (via maarAastasM2) |
| `maarAastasM2` | Yes — drives laekuminePerioodis, saldoLopp, maarKuusM2 | Is the aggregate | Yes (print L3648) |

### Classification

**UI EXPLANATION ONLY: per-investment saldost, koguda, aastasKoguda rows**

The per-investment split (`invArvutusread` rows with `saldost`,
`koguda`, `aastasKoguda`) is an explanatory breakdown shown only
in the interactive Tab 4 UI. It does not appear in the print
output. It does not feed any downstream calculation that isn't
also reachable from the aggregate sum. Its purpose is to help the
user understand *why* the RF rate is what it is — not to define
the rate itself.

Evidence:
- Print section "Fondid ja laen" (L3645–3682) shows only the
  aggregate `maarAastasM2` rate — no per-investment detail rows.
- The `maarAastasM2` aggregate is order-independent (proven in
  Q2 analysis): redistributing saldo between same-year items
  does not change the total rate.
- No policy finding, recommendation, or monthly payment depends
  on individual `saldost` or `koguda` values.

**CANONICAL OUTPUT: aggregate maarAastasM2 and derived values**

The following values are canonical plan output — they appear in
print, feed monthly payment calculations, and drive policy
findings:

- `maarAastasM2` → print (L3648), korteriteKuumaksed (L519)
- `laekuminePerioodis` → RF closing balance
- `saldoLopp` → RF closing balance display
- `investRemondifondist` → RF closing balance
- `sum(aastasKoguda)` → intermediate to maarAastasM2

### Consequence for same-year ordering

Since the per-investment detail is **UI explanation only** and
the aggregate is **order-independent**, the same-year tie-break
question (Q2) affects only the display of explanatory rows —
not any canonical plan output.

This means:
1. Fixing the same-year tie-break is a **UI consistency** concern,
   not a **correctness** concern.
2. No regression test for aggregates can detect a same-year
   reordering — the totals are identical.
3. A regression test for per-row saldost/koguda values WOULD
   detect the change, but such a test would be locking down a
   UI explanation detail, not a plan output.

---

## 8. Funding source vocabulary

### Complete source inventory

| Source value | Created by | Read by | Semantic meaning |
|-------------|-----------|---------|-----------------|
| `"Remondifond"` | UI dropdown (L1921, L2010) | majanduskavaCalc.js `computeRF` (L158, L165, L172) | Investment funded from repair fund accumulation |
| `"Laen"` | UI dropdown (L1921, L2010) | majanduskavaCalc.js `isConditional` (L152), `sumLaen` (L158); MajanduskavaApp.jsx loan sync (L1238, L1262, L1329, etc.); planConsistency.js (L44) | Investment funded by bank loan |
| `"Toetus"` | UI dropdown (L1921, L2010) | **Not read by any calculation** | External grant / subsidy |
| `"Sihtmakse"` | UI dropdown (L1921, L2010) | **Not read by any calculation** | Targeted one-off owner payment |
| `""` | `lisaRahpiiriRida` (L1214, L1311) | investmentStatus real-row filter; UI disabled state | Placeholder — not yet selected |
| `"REPAIR_FUND"` | **Not created by UI** | computePlan.js `sumFundingBySource` (L170) | English enum: repair fund |
| `"RESERVE"` | **Not created by UI** | computePlan.js `sumFundingBySource` (L171) | English enum: reserve capital |
| `"LOAN"` | **Not created by UI** | computePlan.js inline filter (L174), validation loop (L303) | English enum: loan |
| `"GRANT"` | **Not created by UI** | **Not read by any code** | English enum: grant (exists only in migration map) |
| `"ONE_OFF"` | **Not created by UI** | **Not read by any code** | English enum: one-off payment (exists only in migration map) |

### Legacy aliases (migration only)

These values may exist in old saved files and are converted on import
(MajanduskavaApp.jsx L821):

| Legacy value | Migrated to | Note |
|-------------|------------|------|
| `"Erakorraline makse"` | `"Sihtmakse"` | Old Estonian name for targeted payment |
| `"Reservkapital"` | `"Remondifond"` | **Semantically questionable** — see Q1 |

English enum values are also migrated on import (L876):

| English value | Migrated to | Semantically correct? |
|--------------|------------|----------------------|
| `"REPAIR_FUND"` | `"Remondifond"` | **Yes** |
| `"RESERVE"` | `"Remondifond"` | **No** — conflates reserve with repair fund |
| `"LOAN"` | `"Laen"` | **Yes** |
| `"GRANT"` | `"Toetus"` | **Yes** |
| `"ONE_OFF"` | `"Sihtmakse"` | **Yes** |

### Active vocabularies in the codebase

**UI vocabulary** (created by UI, consumed by UI-layer calculations):
`"Remondifond"`, `"Laen"`, `"Toetus"`, `"Sihtmakse"`, `""`

**Compute vocabulary** (used in computePlan.js, never actually matched
against UI-created data):
`"REPAIR_FUND"`, `"RESERVE"`, `"LOAN"`

**Result:** The two vocabularies **never intersect at runtime.**
computePlan.js outflows (`rfOutflowThisYearEUR`,
`reserveOutflowThisYearEUR`, `loanOutflowThisYearEUR`) are always
**zero** for user-created investments, because source strings don't
match. The Tee 1 closing balance logic in computePlan.js is
**currently inert.** The UI relies entirely on
`computeRemondifondiArvutus` for fund balance calculations.

### CANONICAL: proposed unified vocabulary

The canonical vocabulary uses the UI strings, because those are
what actually exists in `plan.investments.items` at runtime:

| Canonical value | Meaning | Status |
|----------------|---------|--------|
| `"Remondifond"` | Funded from repair fund | **CANONICAL** |
| `"Laen"` | Funded by bank loan | **CANONICAL** |
| `"Toetus"` | External grant / subsidy | **CANONICAL** |
| `"Sihtmakse"` | Targeted one-off owner payment | **CANONICAL** |
| `""` | Placeholder (source not yet selected) | **CANONICAL** (transient editing state) |

All other values are non-canonical:

| Value | Classification | Migration path |
|-------|---------------|---------------|
| `"REPAIR_FUND"` | **NON-CANONICAL** (compute vocabulary) | Replace with `"Remondifond"` in computePlan.js |
| `"RESERVE"` | **NON-CANONICAL** (compute vocabulary) | No direct equivalent — see Q1 |
| `"LOAN"` | **NON-CANONICAL** (compute vocabulary) | Replace with `"Laen"` in computePlan.js |
| `"GRANT"` | **LEGACY** (migration map only) | Already migrated to `"Toetus"` on import |
| `"ONE_OFF"` | **LEGACY** (migration map only) | Already migrated to `"Sihtmakse"` on import |
| `"Erakorraline makse"` | **LEGACY** (old saved files) | Already migrated to `"Sihtmakse"` on import |
| `"Reservkapital"` | **LEGACY** (old saved files) | Migrated to `"Remondifond"` — semantically wrong, see Q1 |

### If unified: what changes in computePlan.js

When the vocabulary is unified, computePlan.js should match the
canonical values:

```
Current (inert):                     Unified (active):
sumFundingBySource(fp, "REPAIR_FUND")  → sumFundingBySource(fp, "Remondifond")
sumFundingBySource(fp, "RESERVE")      → (no direct equivalent — see Q1)
source === "LOAN"                      → source === "Laen"
```

This would make computePlan.js outflows live — they would produce
non-zero values and feed into `repairFundClosingEUR` and
`reserveClosingEUR`. Before doing this, the RESERVE → "Remondifond"
conflation in Q1 must be resolved.

---

## 9. Vocabulary mismatch impact on planning/outflow calculations

### Complete inventory of source-dependent calculations

#### ACTIVE PATH — UI vocabulary, produces real results

| # | File:function | Source match | Vocabulary | Status |
|---|--------------|-------------|-----------|--------|
| A1 | `majanduskavaCalc.js:152` `isConditional` | `=== "Laen"` | UI | **ACTIVE** — drives scenario split (kindladInv vs koikInv) |
| A2 | `majanduskavaCalc.js:158` `sumLaen` | `=== "Laen"` | UI | **ACTIVE** — drives `onLaen` flag |
| A3 | `majanduskavaCalc.js:165` `investRemondifondist` | `=== "Remondifond"` | UI | **ACTIVE** — drives saldo closing, is the RF outflow equivalent |
| A4 | `majanduskavaCalc.js:172` per-inv `rfSumma` | `=== "Remondifond"` | UI | **ACTIVE** — drives saldo allocation detail and `maarAastasM2` |
| A5 | `MajanduskavaApp.jsx:564` orphan loan cleanup | `=== "Laen"` | UI | **ACTIVE** — safety net useEffect |
| A6 | `MajanduskavaApp.jsx:1178,1285` `hasLoan` | `=== "Laen"` | UI | **ACTIVE** — deletion cascade |
| A7 | `MajanduskavaApp.jsx:1238,1262,1329` loan sync | `=== "Laen"` | UI | **ACTIVE** — loan create/remove triggers |
| A8 | `MajanduskavaApp.jsx:1420` removeLoan cleanup | `!== "Laen"` | UI | **ACTIVE** — strips Laen entries |
| A9 | `planConsistency.js:44` | `=== "Laen"` | UI | **ACTIVE** — cross-ref integrity check |

#### INERT PATH — compute vocabulary, always produces zero

| # | File:function | Source match | Vocabulary | Status |
|---|--------------|-------------|-----------|--------|
| I1 | `computePlan.js:170` `rfOutflowThisYearEUR` | `=== "REPAIR_FUND"` | Compute | **INERT** — always 0 for UI data |
| I2 | `computePlan.js:171` `reserveOutflowThisYearEUR` | `=== "RESERVE"` | Compute | **INERT** — always 0 |
| I3 | `computePlan.js:174` `loanOutflowThisYearEUR` | `=== "LOAN"` | Compute | **INERT** — always 0 |
| I4 | `computePlan.js:303` loan validation in rec loop | `=== "LOAN"` | Compute | **INERT** — never matches, no findings generated |

#### DOWNSTREAM of inert path — cascading zero effects

| # | File:line | Depends on | Value at runtime | Effect |
|---|----------|-----------|-----------------|--------|
| D1 | `computePlan.js:218` `repairFundClosingEUR` | I1 (`rfOutflow = 0`) | `opening + income - 0` = opening + income | **Overstated** — never deducts investment outflows |
| D2 | `computePlan.js:219` `reserveClosingEUR` | I2 (`reserveOutflow = 0`) | `opening + planned - 0` = opening + planned | **Overstated** — same |
| D3 | `computePlan.js:222` `rfShortfallEUR` | D1 | Always 0 (closing never negative from investments) | **Never triggers** |
| D4 | `computePlan.js:223` `rfSuggestedMonthlyRateEurPerM2` | D3 | Always equals current `rfRate` | **No suggestion produced** |
| D5 | `computePlan.js:226` `rfSuggestedOneOffTotalEUR` | D3 | Always 0 | **No suggestion produced** |
| D6 | `computePlan.js:323` RF_NEG finding | D1 | Never triggers (closing overstated) | **Missing finding** |
| D7 | `computePlan.js:330` RES_NEG finding | D2 | Never triggers (closing overstated) | **Missing finding** |
| D8 | `policyRuntime.js:43` RF_NEG remedy | D1 via `derived.funds` | rfShortfall = 0 → no remedy | **Missing remedy** |
| D9 | `policyRuntime.js:65` ONE_OFF remedy | D1 via `derived.funds` | rfShortfall = 0 → no remedy | **Missing remedy** |
| D10 | `policyEngine.js:46` RF_NEG Solvere finding | D1 via `metrics.funds` | Never triggers | **Missing finding** |
| D11 | `evaluatePolicy.ts:46` RF_NEG module finding | D1 via `metrics.funds` | Never triggers | **Missing finding** |

### Duplicate calculations across vocabularies

| Concept | Active (UI vocab) | Inert (compute vocab) | Same result? |
|---------|------------------|----------------------|-------------|
| RF outflow from investments | A3: `investRemondifondist` = sum of `"Remondifond"` | I1: `rfOutflowThisYearEUR` = sum of `"REPAIR_FUND"` | **No** — active produces real sum, inert produces 0 |
| Loan outflow from investments | A2: `sumLaen` = sum of `"Laen"` | I3: `loanOutflowThisYearEUR` = sum of `"LOAN"` | **No** — same |
| RF closing balance | Active: `saldoLopp` = saldoAlgus + laekumine - investRemondifondist | D1: `repairFundClosingEUR` = opening + income - 0 | **Diverge** — active deducts investments, inert does not |
| Is investment loan-funded? | A1: `isConditional` checks `"Laen"` | I4: rec loop checks `"LOAN"` | **No** — A1 works, I4 never matches |

### What the UI actually displays

The UI uses the **active path** exclusively for fund balances:
- `ra.saldoLopp` (L2553, L2555, L3102, L3104) — from `computeRemondifondiArvutus`
- `derived.funds.repairFundClosingEUR` is **not rendered** in the UI

The `derived.funds.repairFundClosingEUR` value (D1) is consumed only
by policy engines (D8–D11) which produce findings based on the
inert (always-zero-outflow) closing balance. This means:
- Policy RF_NEG / RES_NEG findings from computePlan.js and Solvere
  evaluate against an **overstated** closing balance
- The UI shows the correct `saldoLopp` from the active path
- User sees a negative saldo in UI but no corresponding finding

### Minimal change surface for vocabulary unification

To make the inert path active, change **4 string literals** in
`computePlan.js`:

```
L170: "REPAIR_FUND" → "Remondifond"       // rfOutflowThisYearEUR
L171: "RESERVE"     → (resolve Q1 first)   // reserveOutflowThisYearEUR
L174: "LOAN"        → "Laen"              // loanOutflowThisYearEUR
L303: "LOAN"        → "Laen"              // rec loop loan validation
```

**Preconditions before applying:**
1. **Q1 must be resolved** — what does `"RESERVE"` map to? There is
   no `"Reservkapital"` source in the UI dropdown. Options:
   - Remove the `reserveOutflowThisYearEUR` line entirely (no UI
     source feeds it)
   - Map to a new canonical source if reserve-funded investments
     are ever added to the UI
2. **Closing balance divergence must be reconciled** — after
   unification, `repairFundClosingEUR` will deduct real RF outflows.
   This may trigger RF_NEG findings that were previously silent.
   Verify against `saldoLopp` from the active path.
3. **Policy tests need updating** — policyRuntime tests inject
   `repairFundClosingEUR` directly. After unification, the
   end-to-end value changes.

**Files affected:** 1 file (`computePlan.js`), 4 string edits,
plus downstream test adjustments.

---

## 10. Closing balance divergence: UI path vs computePlan.js

### The two parallel formulas

**UI path** (`computeRemondifondiArvutus`, majanduskavaCalc.js L225):

```
saldoLopp = saldoAlgus + laekuminePerioodis - investRemondifondist
```

Where:
- `saldoAlgus` = `Math.round(parseFloat(remondifond.saldoAlgus))` — local React state, user-entered
- `laekuminePerioodis` = `Math.round(maarAastasM2 * koguPind * mEq / 12)`
- `maarAastasM2` = computed from investments (or user override)
- `investRemondifondist` = sum of `fundingPlan` where `source === "Remondifond"` — **active, real values**

**computePlan.js path** (L218):

```
repairFundClosingEUR = repairFundOpeningEUR + repairFundIncomePeriodEUR - rfOutflowThisYearEUR
```

Where:
- `repairFundOpeningEUR` = `plan.openingBalances.repairFundEUR` — plan state field
- `repairFundIncomePeriodEUR` = `rfRate * totAreaM2 * monthEq`
- `rfRate` = `plan.funds.repairFund.monthlyRateEurPerM2` — synced from UI via useEffect (L574)
- `rfOutflowThisYearEUR` = sum of `fundingPlan` where `source === "REPAIR_FUND"` — **inert, always 0**

### Step-by-step comparison

| Component | UI path | computePlan.js | Same? |
|-----------|---------|---------------|-------|
| **Opening balance** | `remondifond.saldoAlgus` (React state) | `plan.openingBalances.repairFundEUR` (plan state) | **NO** — different sources (see below) |
| **Income** | `maarAastasM2 * koguPind * mEq / 12` | `rfRate * totAreaM2 * monthEq` | **YES** ¹ — `rfRate` is synced from `maarAastasM2 / 12` via useEffect (L574), so `rfRate * totAreaM2 * monthEq` = `(maarAastasM2/12) * koguPind * monthEq` = `maarAastasM2 * koguPind * mEq / 12` |
| **Outflow** | `investRemondifondist` (sum of `"Remondifond"`) | `rfOutflowThisYearEUR` (sum of `"REPAIR_FUND"`) | **NO** — vocabulary mismatch makes computePlan.js = 0 |
| **Rounding** | `Math.round()` on income | `round2()` (2 decimal places) on all components | **MINOR** — ≤1 EUR difference |

¹ Subject to one-render-cycle lag: the useEffect at L574 syncs
`maarAastasM2 / 12` → `plan.funds.repairFund.monthlyRateEurPerM2`
after remondifondiArvutus completes. During the same render cycle,
`computePlan` may see the previous `rfRate`. After stabilization,
they converge.

### Divergence source #1: Opening balance (structural)

`remondifond.saldoAlgus` is local React state, set by:
- User input in the RF saldo field (L2368–2369)
- Import/load from saved JSON (L930, L938)

`plan.openingBalances.repairFundEUR` is in the plan schema
(planSchema.js L71) with default 0, but:
- **No UI writes to it** — the saldo input field writes to
  `remondifond.saldoAlgus`, not to `plan.openingBalances`
- The only code that writes to `openingBalances.repairFundEUR` is
  the policy remedy `ONE_OFF_PAYMENT` (policyRuntime.js L72) which
  patches it via `{ op: "increment", path: "openingBalances.repairFundEUR" }`

**Result:** At runtime, `plan.openingBalances.repairFundEUR` is
always 0 (default) unless a ONE_OFF_PAYMENT remedy has been applied.
The UI shows the user-entered saldo. This is a **permanent
structural divergence** unrelated to vocabulary mismatch.

### Divergence source #2: Outflow (vocabulary mismatch)

This is the vocabulary mismatch documented in section 9.
`rfOutflowThisYearEUR` matches `"REPAIR_FUND"` but UI creates
`"Remondifond"` entries → outflow is always 0 → closing balance
never deducts investment costs.

### Divergence source #3: Reserve closing (same pattern)

**UI path:** No explicit reserve closing formula exists in
`computeRemondifondiArvutus`. Reserve is managed via
`plan.funds.reserve.plannedEUR` directly, with no outflow
deduction.

**computePlan.js path** (L219):
```
reserveClosingEUR = reserveOpeningEUR + reservePlannedEUR - reserveOutflowThisYearEUR
```

- `reserveOpeningEUR` = `plan.openingBalances.reserveEUR` = always 0
  (same problem as RF — UI doesn't write here)
- `reserveOutflowThisYearEUR` = sum of `"RESERVE"` = always 0
  (vocabulary mismatch)

**Result:** `reserveClosingEUR = 0 + reservePlannedEUR - 0` = the
user's planned reserve amount. This is not a closing balance — it's
just echoing the input.

### Concrete example scenario

Plan inputs:
- `remondifond.saldoAlgus` = 5000 (user enters 5000 €)
- `plan.openingBalances.repairFundEUR` = 0 (default, never written)
- One investment: Katus, 2026, totalCostEUR = 80000
  - `fundingPlan: [{ source: "Remondifond", amountEUR: 80000 }]`
- `maarAastasM2` computed = 16.0 €/m²/a (from investments)
- `koguPind` = 500 m²
- `monthEq` = 12

**UI path (`saldoLopp`):**
```
saldoAlgus           =  5 000
laekuminePerioodis   = Math.round(16.0 * 500 * 12 / 12) = 8 000
investRemondifondist = 80 000
saldoLopp            = 5 000 + 8 000 - 80 000 = -67 000 ← NEGATIVE
```

UI displays: **-67 000 €** in red.

**computePlan.js path (`repairFundClosingEUR`):**
```
repairFundOpeningEUR    =      0  (plan.openingBalances default)
rfRate                  =  16.0/12 = 1.333 €/m²/kuu (synced via useEffect)
repairFundIncomePeriodEUR = round2(1.333 * 500 * 12) = 8 000
rfOutflowThisYearEUR    =      0  (vocabulary mismatch → no match)
repairFundClosingEUR    = 0 + 8 000 - 0 = 8 000 ← POSITIVE
```

computePlan reports: **+8 000 €**. No RF_NEG finding. No shortfall.
No suggested rate increase. No ONE_OFF remedy.

**Divergence: -67 000 vs +8 000.** Two independent causes:
1. Opening balance: 5 000 vs 0 (structural — different state sources)
2. Outflow: 80 000 vs 0 (vocabulary mismatch)

### Summary of divergence causes

| Cause | Affects | Fixable by vocabulary unification? |
|-------|---------|-----------------------------------|
| Opening balance: `remondifond.saldoAlgus` vs `plan.openingBalances.repairFundEUR` | Both RF and reserve closing | **No** — structural, needs state sync |
| Outflow: `"Remondifond"` vs `"REPAIR_FUND"` | RF closing only | **Yes** — change 1 string in computePlan.js |
| Outflow: `"Laen"` vs `"LOAN"` | Loan outflow only | **Yes** — change 2 strings |
| Reserve outflow: no UI source matches `"RESERVE"` | Reserve closing | **Partially** — see Q1 |
| Income rounding: `Math.round` vs `round2` | Both | **Minor** — ≤1 EUR |

### Minimal fix surface (not yet applied)

To eliminate divergence, two independent changes are needed:

**Change A — vocabulary** (section 9 scope):
4 string literals in `computePlan.js`

**Change B — opening balance sync**:
Sync `remondifond.saldoAlgus` → `plan.openingBalances.repairFundEUR`
(and equivalently for reserve). This requires either:
- A useEffect that writes to plan state, or
- Changing computePlan.js to read from `remondifond.saldoAlgus`
  instead of `plan.openingBalances`

Both changes are prerequisites for making computePlan.js closing
balances match the UI. Neither alone is sufficient.

---

## 11. Remondifondi opening balance: state topology and sync

### All locations where RF opening balance is stored, written, or read

| # | Location | Variable | Type | Written by | Read by |
|---|----------|----------|------|-----------|---------|
| S1 | `MajanduskavaApp.jsx:462` | `remondifond.saldoAlgus` | React state (string) | User input (L2369), import/load (L930, L938), tab reset (L1574) | `computeRemondifondiArvutus` via `saldoAlgusRaw` (L497) |
| S2 | `MajanduskavaApp.jsx:461` | `repairFundSaldo` | React state (string) | User input (L2369), import/load (L927), tab reset (L1574) | Save bundle only (L700) |
| S3 | `planSchema.js:71` | `plan.openingBalances.repairFundEUR` | Plan state (number, default 0) | ONE_OFF_PAYMENT remedy only (policyRuntime.js L72), import/load via `setPlan(candidateState)` (L925) | `computePlan.js` (L213) |

### Write paths in detail

**User input (L2369):**
```js
onChange={(v) => {
  setRemondifond(p => ({ ...p, saldoAlgus: v }));  // → S1
  setRepairFundSaldo(v);                             // → S2
  // plan.openingBalances.repairFundEUR is NOT updated  ← S3 stays 0
}}
```

The user's saldo input writes to S1 and S2 simultaneously.
S3 (`plan.openingBalances.repairFundEUR`) is **never written** by
user input. There is no useEffect or other mechanism that syncs
S1 → S3.

**Import/load (L925–944):**
```js
setPlan(candidateState);                              // → S3 (from saved plan state)
setRepairFundSaldo(data.repairFundSaldo ?? "");       // → S2
setRemondifond({ saldoAlgus: data.remondifond.saldoAlgus || "", ... });  // → S1
```

On load, S1 gets its value from the save bundle's `remondifond`
object. S3 gets whatever was in the saved plan's
`openingBalances.repairFundEUR`. If the saved plan was created by
normal UI usage, S3 is 0 (since user input never writes there).
If a ONE_OFF_PAYMENT remedy was applied before saving, S3 may be
non-zero — but S1 is still the user-entered string value.

**ONE_OFF_PAYMENT remedy (policyRuntime.js L72):**
```js
{ op: "increment", path: "openingBalances.repairFundEUR", value: amount }
```

This writes to S3 only. S1 and S2 are **not updated**. After
applying this remedy, S3 has a positive value but S1 still shows
the original user-entered saldo.

**Tab reset (L1574):**
```js
setRepairFundSaldo("");      // → S2
setRemondifond({ saldoAlgus: "", ... });  // → S1
// plan.openingBalances is NOT reset    ← S3 keeps its value
```

### Sync diagram

```
User input ──→ S1 (remondifond.saldoAlgus) ──→ computeRemondifondiArvutus → saldoLopp
          └──→ S2 (repairFundSaldo)         ──→ save bundle only

ONE_OFF_PAYMENT ──→ S3 (plan.openingBalances.repairFundEUR) ──→ computePlan.js → repairFundClosingEUR

                         S1 ←✗→ S3  (no sync in either direction)
```

### Canonical runtime source

**S1 (`remondifond.saldoAlgus`) is the canonical runtime source.**

Evidence:
- It is the only source written by user input
- It feeds the active calculation path (`computeRemondifondiArvutus`)
- It feeds the displayed `saldoLopp` value
- S3 is inert at runtime (computePlan.js closing balance is never
  rendered in UI — see section 10)

S2 (`repairFundSaldo`) is a **legacy compatibility alias** of S1,
written simultaneously by the same onChange handler. It appears in
the save bundle for backwards compatibility but is not read by any
calculation.

S3 (`plan.openingBalances.repairFundEUR`) is a **plan schema field**
intended for the computePlan.js path but never populated by the UI.

### When the paths diverge

| Event | S1 | S3 | Diverged? |
|-------|----|----|-----------|
| App start (fresh plan) | `""` (→ 0 after parse) | `0` (default) | No — both effectively 0 |
| User enters 5000 | `"5000"` (→ 5000) | `0` (unchanged) | **Yes** — 5000 vs 0 |
| Save + reload | `"5000"` (from bundle) | `0` (from plan state) | **Yes** — same |
| ONE_OFF_PAYMENT applied (amount=3000) | `"5000"` (unchanged) | `3000` (incremented) | **Yes** — different values for different reasons |
| User enters 5000, then ONE_OFF applied | `"5000"` | `3000` | **Yes** — S1=user saldo, S3=remedy increment (not cumulative with S1) |

### Concrete example: vocabulary fixed but sync missing

Assume vocabulary mismatch is resolved (section 9 applied):
`"REPAIR_FUND"` → `"Remondifond"` in computePlan.js.

Plan:
- User enters RF saldo = 10 000 (S1 = "10000", S3 = 0)
- One investment: 50 000 funded by `"Remondifond"`
- `maarAastasM2` = 10 €/m²/a, `koguPind` = 500 m², `monthEq` = 12

**UI path (correct):**
```
saldoAlgus         = 10 000
laekuminePerioodis =  5 000    (10 * 500 * 12 / 12)
investRemondifondist = 50 000
saldoLopp          = 10 000 + 5 000 - 50 000 = -35 000
```

**computePlan.js path (vocabulary fixed but sync missing):**
```
repairFundOpeningEUR    =     0    ← S3, not synced from S1
repairFundIncomePeriodEUR = 5 000  (synced via rfRate useEffect)
rfOutflowThisYearEUR    = 50 000   ← NOW ACTIVE (vocabulary fixed)
repairFundClosingEUR    = 0 + 5 000 - 50 000 = -45 000
```

**Divergence: -35 000 vs -45 000.** The 10 000 difference is exactly
the unsynced opening balance. Vocabulary fix removed the outflow
divergence but the opening balance divergence remains.

The computePlan.js path would now trigger RF_NEG with shortfall
45 000, while the true shortfall visible in UI is 35 000.
Suggested rate increases and ONE_OFF amounts would be overstated
by 10 000.

### Minimal sync mechanism

**Option A — useEffect sync (S1 → S3):**
```js
useEffect(() => {
  const parsed = Math.round(parseFloat(String(remondifond.saldoAlgus).replace(",", ".")) || 0);
  setPlan(p => {
    if ((p.openingBalances?.repairFundEUR || 0) === parsed) return p;
    return { ...p, openingBalances: { ...p.openingBalances, repairFundEUR: parsed } };
  });
}, [remondifond.saldoAlgus]);
```

**Pros:** Minimal change (1 useEffect). Follows existing pattern
(rfRate sync at L572–579).
**Cons:** One-render-cycle lag. S3 gets the same value as S1, but
ONE_OFF_PAYMENT remedy increments S3 without updating S1 — after
remedy application, S1 and S3 diverge again.

**Option B — read S1 directly in computePlan.js:**
Pass `remondifond.saldoAlgus` as an explicit input to `computePlan`.

**Pros:** No sync lag. Single source of truth.
**Cons:** Changes `computePlan` signature. Requires parsing the
string in the engine layer.

**Option C — eliminate S3, always derive from S1:**
Remove `openingBalances.repairFundEUR` from the plan schema.
Make `computePlan` accept a parsed opening balance parameter.
Remedies that need to adjust opening balance would patch S1 instead.

**Pros:** Cleanest. No divergence possible.
**Cons:** Largest change. Breaks remedy patch path. Requires
migrating saved plans.

### Reserve opening balance: same pattern

The reserve fund has the same topology:

| Location | Variable | Written by | Read by |
|----------|----------|-----------|---------|
| `resKap.saldoAlgus` | React state | User input (L2625), import (L947) | UI display only (L2611) |
| `plan.openingBalances.reserveEUR` | Plan state | Default 0, never written by UI | `computePlan.js` (L214) |

Reserve has no active calculation path equivalent to
`computeRemondifondiArvutus` — there is no `reserveClosingBalance`
in the UI layer. The user-entered `resKap.saldoAlgus` is displayed
but not used in any closing balance formula. The computePlan.js
`reserveClosingEUR` uses S3 (always 0) and is never rendered.

---

## 12. RESERVE semantics: Reservkapital vs Remondifond

### What these terms mean in Estonian housing law (KrtS)

**Reservkapital** (KrtS § 8): A mandatory cash reserve that an
apartment association must maintain — at least 1/12 of annual
operating costs. It covers unexpected shortfalls in any expense
category. It is **not** earmarked for specific investments.

**Remondifond** (repair fund): An accumulation fund for planned
major works (roof, facade, pipes). Owners pay a monthly per-m²
rate into this fund. It **is** earmarked for specific investments.

These are **two separate legal funds** with different purposes.
"Reservkapital" ≠ "Remondifond".

### Where each concept appears in the codebase

#### Reservkapital (reserve capital)

| # | Location | Variable / value | Purpose | Active? |
|---|----------|-----------------|---------|---------|
| R1 | `planSchema.js:71` | `plan.openingBalances.reserveEUR` | Reserve opening balance | Default 0, never written by UI |
| R2 | `planSchema.js:67` | `plan.funds.reserve.plannedEUR` | Planned annual reserve collection | **Active** — user edits (L2633) |
| R3 | `computePlan.js:207` | `reserveRequiredEUR` | KrtS § 8 minimum (1/12 annual costs + loans) | **Active** — computed, used in RESERVE_LOW finding |
| R4 | `computePlan.js:219` | `reserveClosingEUR` | = reserveOpeningEUR + plannedEUR - reserveOutflow | **Inert** — opening = 0, outflow = 0 |
| R5 | `computePlan.js:171` | `reserveOutflowThisYearEUR` | sum of `"RESERVE"` funding | **Inert** — UI never creates `"RESERVE"` entries |
| R6 | `MajanduskavaApp.jsx:2611` | `rkSaldoAlgus` (from `resKap.saldoAlgus`) | User-entered reserve opening saldo | **Active** in UI display only, not in any closing formula |
| R7 | `MajanduskavaApp.jsx:2614` | `rkSaldoLopp` | = rkSaldoAlgus + rkKogumine - rkKasutamine | **Active** in UI display only (L2614) |
| R8 | `majanduskavaCalc.js:46` | `computeReserveMin` | KrtS § 8 minimum calculation | **Active** — drives auto-fill of plannedEUR (L486) |
| R9 | `MajanduskavaApp.jsx:486` | auto-fill useEffect | Writes `reserveRequiredEUR` → `plan.funds.reserve.plannedEUR` | **Active** — unless `resKapManual` is true |

#### Remondifond (repair fund)

| # | Location | Variable / value | Purpose | Active? |
|---|----------|-----------------|---------|---------|
| F1 | `planSchema.js:66` | `plan.funds.repairFund.monthlyRateEurPerM2` | RF monthly rate per m² | **Active** — synced from maarAastasM2 (L574) |
| F2 | `MajanduskavaApp.jsx:462` | `remondifond.saldoAlgus` | RF opening balance | **Active** — canonical source (section 11) |
| F3 | `majanduskavaCalc.js:165` | `investRemondifondist` | Sum of `"Remondifond"` funding from investments | **Active** |
| F4 | `majanduskavaCalc.js:225` | `saldoLopp` | RF closing balance | **Active** — displayed in UI |

#### The funding source `"RESERVE"` in computePlan.js

There is exactly **one** place that reads `"RESERVE"` as a funding
source: `computePlan.js:171`. The UI funding dropdown offers four
sources: `"Remondifond"`, `"Laen"`, `"Toetus"`, `"Sihtmakse"`.
There is **no `"Reservkapital"` option** in the dropdown. A user
cannot create a fundingPlan entry with source `"RESERVE"` or
`"Reservkapital"` through the UI.

This means `reserveOutflowThisYearEUR` (R5) has **no data source**
at runtime. It is always zero. The concept of "funding an investment
from reserve capital" does not exist in the current UI.

### The legacy migration mapping

At `MajanduskavaApp.jsx:876`:
```js
{ REPAIR_FUND: "Remondifond", RESERVE: "Remondifond", LOAN: "Laen", GRANT: "Toetus", ONE_OFF: "Sihtmakse" }
```

`RESERVE → "Remondifond"` maps reserve capital to repair fund.
This is **semantically wrong** — it treats reserve-funded items as
repair-fund-funded. But since the UI has no "Reservkapital" funding
source, there was no correct target available at migration time.

At `MajanduskavaApp.jsx:821` (old saved file migration):
```js
a === "Reservkapital" ? "Remondifond" : a
```

Same conflation: old files that used `"Reservkapital"` as a funding
source get remapped to `"Remondifond"`.

### Reserve closing balance: two independent formulas

**computePlan.js (R4, L219):**
```
reserveClosingEUR = reserveOpeningEUR + reservePlannedEUR - reserveOutflowThisYearEUR
                  = 0              + plannedEUR        - 0
                  = plannedEUR
```

This just echoes the user's planned reserve amount. It is not a
real closing balance — there is no opening balance and no outflow.

**UI (R7, L2614):**
```
rkSaldoLopp = rkSaldoAlgus + rkKogumine - rkKasutamine
```

Where:
- `rkSaldoAlgus` = user-entered reserve opening saldo (React state)
- `rkKogumine` = `plan.funds.reserve.plannedEUR` (same as computePlan)
- `rkKasutamine` = user-entered planned usage amount (React state)

This is a real closing balance with all three components. But it
is display-only — no downstream calculation reads `rkSaldoLopp`.

### `plan.openingBalances.reserveEUR`: dead field

| Aspect | Value |
|--------|-------|
| Defined in | `planSchema.js:72` — default `0` |
| Written by UI | **Never** |
| Written by remedies | **Never** (no reserve remedy exists) |
| Read by | `computePlan.js:214` only |
| Actual runtime value | Always `0` |

The user enters reserve opening saldo in `resKap.saldoAlgus`
(React state), which is **not synced** to
`plan.openingBalances.reserveEUR`. Same structural problem as
the RF opening balance (section 11), but more severe because
there is not even a remedy pathway that writes to it.

### Conclusion: can `RESERVE` be mapped to a UI value?

**No.** There is no UI funding source that represents "funded from
reserve capital." The UI dropdown does not offer it. The concept
of deducting investment costs from the reserve fund does not exist
in the current application model.

When unifying vocabulary in `computePlan.js`:

| computePlan.js value | Action | Rationale |
|---------------------|--------|-----------|
| `"REPAIR_FUND"` → `"Remondifond"` | **Map** | Direct semantic match |
| `"LOAN"` → `"Laen"` | **Map** | Direct semantic match |
| `"RESERVE"` → ??? | **Remove** | No UI runtime equivalent. No dropdown option. No data source. |

`reserveOutflowThisYearEUR` should be **removed or hardcoded to 0**
rather than mapped to any UI value. `reserveClosingEUR` should then
be computed without an outflow term, or replaced entirely by the UI
formula (R7).

If reserve-funded investments are needed in the future, a new UI
dropdown option `"Reservkapital"` should be added first, making the
mapping explicit.

---

## 13. RES_NEG finding: status assessment

### Where RES_NEG is emitted

| # | Location | Condition | Source of `reserveClosingEUR` |
|---|----------|-----------|------------------------------|
| 1 | `computePlan.js:330` | `reserveClosingEUR < 0` | L219: `reserveOpeningEUR + reservePlannedEUR - reserveOutflowThisYearEUR` |
| 2 | `evaluatePolicy.ts:68` | `metrics.funds.reserveClosingEUR < 0` | Same value, passed via `derived.funds` |

### Runtime values of the three inputs

| Input | Source | Runtime value | Why |
|-------|--------|--------------|-----|
| `reserveOpeningEUR` | `plan.openingBalances.reserveEUR` | **Always 0** | UI writes to `resKap.saldoAlgus` (React state), no sync to `plan.openingBalances.reserveEUR` |
| `reservePlannedEUR` | `plan.funds.reserve.plannedEUR` | **≥ 0** | Auto-filled with KrtS § 8 minimum (L486), or user-edited |
| `reserveOutflowThisYearEUR` | sum of `"RESERVE"` funding | **Always 0** | No UI dropdown option creates `"RESERVE"`. Vocabulary has no runtime source (section 12). |

### Result

```
reserveClosingEUR = 0 + plannedEUR - 0 = plannedEUR
```

Since `plannedEUR` is auto-filled with a non-negative KrtS § 8
minimum (or manually set by the user, who cannot enter negative
values through `EuroInput`), `reserveClosingEUR` is **always ≥ 0**.

**RES_NEG can never trigger.** It is dead code under all current
runtime conditions.

### Classification: INERT — known feature-gap

RES_NEG is not a bug. It is a **correctly implemented finding for
a data path that does not yet exist.** Specifically:

1. No opening balance sync exists for reserve (section 11 — same
   pattern as RF, but no useEffect added yet)
2. No `"Reservkapital"` funding source exists in the UI dropdown
   (section 12), so `reserveOutflowThisYearEUR` has no data source
3. The formula `opening + planned - outflow` is structurally correct
   — it would produce the right result if the inputs were populated

The finding becomes active when **both** of these are addressed:
- Reserve opening balance sync (`resKap.saldoAlgus` → `plan.openingBalances.reserveEUR`)
- A mechanism for reserve outflows (either a new funding source or
  direct usage of `resKap.kasutamine`)

### UI reserve closing: already exists, not connected

The UI computes its own reserve closing at L2614:
```js
rkSaldoLopp = rkSaldoAlgus + rkKogumine - rkKasutamine
```

This formula **can** go negative (user enters kasutamine > saldoAlgus
+ kogumine). But this value is display-only and does not feed
`computePlan.js`. The disconnect is identical to the RF pattern
before the opening balance sync was added.

### Existing tests

No test covers `RES_NEG`. The finding is unreachable, so a test
would be vacuous. A test should be added **when** the reserve data
path is activated.

### Next minimal step

When reserve activation is prioritized:
1. Add opening balance sync: `resKap.saldoAlgus` → `plan.openingBalances.reserveEUR` (same pattern as RF sync at L580)
2. Route `resKap.kasutamine` into `reserveOutflowThisYearEUR` (either as a direct value or via a new funding source)
3. Then add a `RES_NEG` regression test

Until then, RES_NEG remains correctly inert. No code change needed.

**Note on testing:** A `reserveClosingEUR` future-year regression
test (analogous to the RF single-year snapshot test) is not added
at this time. The reserve outflow path uses `"RESERVE"` vocabulary,
which is inert — such a test would lock the vocabulary mismatch,
not the single-year snapshot design rule. Add the test when the
reserve outflow path is activated.

---

## 14. Loan source vocabulary: "LOAN" vs "Laen"

### Complete inventory of loan source comparisons

#### ACTIVE PATH — UI vocabulary `"Laen"`

| # | Location | Code | Purpose |
|---|----------|------|---------|
| L1 | `majanduskavaCalc.js:152` | `fp.source === "Laen"` | `isConditional` — drives scenario split |
| L2 | `majanduskavaCalc.js:158` | `fp.source === "Laen"` | `sumLaen` — total loan funding amount |
| L3 | `MajanduskavaApp.jsx:564` | `fp.source === "Laen"` | Orphan loan cleanup |
| L4 | `MajanduskavaApp.jsx:1187,1294` | `fp.source === "Laen"` | `hasLoan` — deletion cascade |
| L5 | `MajanduskavaApp.jsx:1247–1252` | `=== "Laen"` / `!== "Laen"` | Loan sync triggers (condition-item) |
| L6 | `MajanduskavaApp.jsx:1271,1338` | `source === "Laen"` | Remove loan on funding row deletion |
| L7 | `MajanduskavaApp.jsx:1363–1368` | `=== "Laen"` / `!== "Laen"` | Loan sync triggers (standalone) |
| L8 | `MajanduskavaApp.jsx:1429` | `fp.source !== "Laen"` | `removeLoan` strips Laen entries |
| L9 | `MajanduskavaApp.jsx:1930,2019` | `"Laen"` in dropdown | UI dropdown option |
| L10 | `MajanduskavaApp.jsx:1932,1942,2021,2031` | `fp.source === "Laen"` | UI display: loan linkage indicator |
| L11 | `MajanduskavaApp.jsx:2415` | `fp.source === "Laen"` | RF detail table "Tingimuslik" badge |
| L12 | `MajanduskavaApp.jsx:2715,2719` | `fp.source === "Laen"` | "Laenud" section visibility gate |
| L13 | `planConsistency.js:44` | `fp.source === "Laen"` | Loan-investment integrity check |

#### INERT PATH — compute vocabulary `"LOAN"`

| # | Location | Code | Purpose | Status |
|---|----------|------|---------|--------|
| I1 | `computePlan.js:174` | `r.source === "LOAN"` | `loanOutflowThisYearEUR` | **INERT** — always 0, UI creates `"Laen"` |
| I2 | `computePlan.js:303` | `r.source === "LOAN"` | Loan validation in rec loop | **INERT** — never matches, findings never generated |

### What each inert path does (or would do)

**I1: `loanOutflowThisYearEUR`**

```
loanOutflowThisYearEUR = sum of fundingPlan where source === "LOAN"
```

Exposed in `derived.investments.loanOutflowThisYearEUR` (L387).
**Not used** in any closing balance, finding, or downstream
calculation. It is a purely informational output field that is
currently always 0.

**I2: Loan validation (L303–316)**

Filters `fundingPlan` for `source === "LOAN"` entries with
`amountEUR > 0`, then checks:
- `r.loanId` exists → `INV_LOAN_NO_ID` if missing
- Loan found in `plan.loans` → `INV_LOAN_NOT_FOUND` if missing
- `amountEUR <= principalEUR` → `INV_LOAN_OVER_PRINCIPAL` if exceeded

Since no UI-created entry has `source === "LOAN"`, these three
findings are **never generated**. The validation is dead code.

### Structural difference from the remondifond case

| Aspect | Remondifond (resolved) | Loan (current) |
|--------|----------------------|----------------|
| Inert outflow feeds closing balance? | **Yes** — `rfOutflowThisYearEUR` fed `repairFundClosingEUR` | **No** — `loanOutflowThisYearEUR` is output-only, not used in any formula |
| Inert outflow suppresses findings? | **Yes** — RF_NEG never triggered | **No** — loan findings are gated by their own filter, not by an outflow |
| Active path exists in parallel? | Yes — `computeRemondifondiArvutus` | **Yes** — loan sync (L5–L7), `syncLoan`, `isConditional` all use `"Laen"` and work correctly |
| Fixing vocabulary alone is sufficient? | Yes (+ opening balance sync) | **Partially** — vocabulary fix activates I1 and I2, but I2 also requires `loanId` field on fundingPlan entries, which the UI does not create |

### The `loanId` gap

The loan validation at I2 assumes each `"LOAN"` funding row has a
`loanId` field pointing to a `plan.loans` entry. The UI never sets
this field — it uses a different linkage model:

- UI links loan → investment via `loan.sepiiriostudInvId` (loan
  points to investment)
- computePlan.js expects investment → loan via `fp.loanId` (funding
  row points to loan)

These are **inverse directions**. Even after fixing `"LOAN"` →
`"Laen"`, the validation at I2 would fire `INV_LOAN_NO_ID` for
every loan-funded investment, because `fp.loanId` is always
undefined.

### Impact assessment

| What breaks if we only change `"LOAN"` → `"Laen"` in computePlan.js? |
|----------------------------------------------------------------------|
| I1: `loanOutflowThisYearEUR` becomes active — correct, harmless (output-only field) |
| I2: Loan validation fires `INV_LOAN_NO_ID` for every `"Laen"` funding row — **false positive findings** |

### Classification

**I1 (`loanOutflowThisYearEUR`):** Safe to unify. Output-only,
no downstream formula depends on it.

**I2 (loan validation):** **Not safe to unify with vocabulary
change alone.** The `loanId`-based linkage model is incompatible
with the UI's `sepiiriostudInvId`-based model. Fixing vocabulary
without fixing the linkage direction would produce false positives.

---

## 15. Investment–loan linkage: canonical model

### Two linkage models in the codebase

**Model A — loan → investment** (`loan.sepiiriostudInvId`):

The loan record points to the investment it funds. The link value
is the investment's `sourceRefId` (for condition-item investments)
or `inv.id` (for standalone investments).

```
loan.sepiiriostudInvId  →  inv.sourceRefId  OR  inv.id
```

Lookup direction: given a loan, find its investment.
Reverse lookup: given an investment, scan all loans for matching
`sepiiriostudInvId`.

**Model B — investment → loan** (`fundingPlan[].loanId`):

The investment's funding plan row points to the loan it draws from.

```
inv.fundingPlan[].loanId  →  loan.id
```

Lookup direction: given a funding row, find its loan.

### Where each model is used

#### Model A — loan → investment (ACTIVE, 25+ usage sites)

| Category | Locations | Example |
|----------|----------|---------|
| **Loan creation** | `syncLoan` (L1198–1209) | Creates loan with `sepiiriostudInvId: investeeringId` |
| **Loan update** | `syncLoan` (L1201) | Finds loan by `l.sepiiriostudInvId === investeeringId` |
| **Loan deletion cascade** | `eemaldaSeisukordRida` (L1161), `eemaldaInvesteering` (L1191), `eemaldaStandaloneInvesteering` (L1298), `eemaldaRahpiiriRida` (L1272), etc. | Filters `l.sepiiriostudInvId !== id` |
| **Orphan cleanup** | useEffect (L558–561) | Finds loans where `sepiiriostudInvId` has no matching investment |
| **Loan category split** | `majanduskavaCalc.js:107,111` | `l.sepiiriostudInvId` distinguishes planned vs existing loans |
| **Scenario matching** | `majanduskavaCalc.js:247,250` | `koikInvLaenud` / `kindladInvLaenud` matched by `sepiiriostudInvId` |
| **UI loan display** | L2763–2776 | Shows linked investment name, scroll-to link |
| **UI section visibility** | L2715,2719 | "Laenud" section shown when any `"Laen"` funding exists |
| **Loan status styling** | L2752 | Conditional styling when `sepiiriostudInvId && loanStatus === "APPLIED"` |
| **Monthly payments** | L2859–2860 | Splits `olemasolevLaenuAasta` / `planeeritudLaenuAasta` |
| **Tab reset** | L1578 | Filters loans by `removedInvIds.has(sepiiriostudInvId)` |
| **Consistency check** | `planConsistency.js:36–47` | Validates loan ↔ investment integrity |
| **Tests** | 10+ test files | All use `sepiiriostudInvId` |

#### Model B — investment → loan (INERT, 2 usage sites)

| Location | Code | Status |
|----------|------|--------|
| `computePlan.js:304` | `if (!r.loanId)` | **INERT** — `loanId` never exists on UI data |
| `computePlan.js:308` | `loans.find(x => x.id === r.loanId)` | **INERT** — same |

### Which model is canonical

**Model A (`loan.sepiiriostudInvId`) is the canonical runtime model.**

Evidence:
- 25+ active usage sites across UI, calculations, consistency
  checks, and tests
- All loan CRUD operations use this model
- All loan–investment integrity checks use this model
- The loan schema field `sepiiriostudInvId` is set at creation
  (`syncLoan` L1209) and used throughout the lifecycle
- Model B has zero active usage — `loanId` is never set on any
  fundingPlan entry

### What Model B validation would need to work

If `computePlan.js` L303–316 were activated (by fixing `"LOAN"` →
`"Laen"`), every `"Laen"` funding row would fail the `!r.loanId`
check because:

1. `fundingPlan` entries are `{ source: "Laen", amountEUR: N }` —
   no `loanId` field
2. The UI links loan to investment via `syncLoan`, which writes
   `loan.sepiiriostudInvId`, not `inv.fundingPlan[].loanId`
3. There is no mechanism to reverse-populate `loanId` after loan
   creation

### Conclusion

**`computePlan.js` loan validation (L303–316) must be rewritten
or removed.** It cannot be activated by vocabulary change alone.

The two viable paths:

**Path 1 — Rewrite to use canonical Model A:**
Replace L303–316 with a reverse lookup using the canonical model:
```
for each loan with sepiiriostudInvId matching this investment:
  check loan exists
  check fundingPlan "Laen" amount <= loan.principalEUR
```
This aligns with how `planConsistency.js:44` already works.

**Path 2 — Remove L303–316 entirely:**
Loan integrity is already validated by:
- `planConsistency.js:36–47` (orphan detection, fundingPlan
  consistency) — uses canonical Model A
- Orphan cleanup useEffect (L558) — uses canonical Model A
- `syncLoan` guard (L1198) — prevents duplicate loans

The computePlan.js validation is redundant with existing
canonical-model checks. Removing it is the minimal change.

**Recommended: Path 2** — remove L303–316, then safely change
`"LOAN"` → `"Laen"` at L174 to activate `loanOutflowThisYearEUR`.

---

## 16. "Toetus" and "Sihtmakse": funding sources without compute path

### Where these values exist

| Value | Created by | Used in matching/filtering | Used in calculation |
|-------|-----------|---------------------------|-------------------|
| `"Toetus"` | UI dropdown (L1930, L2019) | **Nowhere** | **Nowhere** |
| `"Sihtmakse"` | UI dropdown (L1930, L2019) | **Nowhere** | **Nowhere** |
| `"GRANT"` | Legacy migration map only (L885) | **Nowhere** | **Nowhere** |
| `"ONE_OFF"` | Legacy migration map only (L885) | **Nowhere** | **Nowhere** |

### Legacy/migration paths

**English → Estonian migration** (L885):
```
GRANT  → "Toetus"
ONE_OFF → "Sihtmakse"
```

**Old Estonian name migration** (L830):
```
"Erakorraline makse" → "Sihtmakse"
```

After import, all legacy values are converted to canonical UI
vocabulary. No English or old Estonian values survive in runtime data.

### What these sources do at runtime

`"Toetus"` and `"Sihtmakse"` fundingPlan entries:

1. **Count toward `kaetud`** in the canonical coverage calculation
   (investmentStatus, UI coverage display, aggregate summary) —
   they reduce `katmata` for that investment
2. **Do not produce any outflow** — no code in `computePlan.js`
   or `majanduskavaCalc.js` matches these values
3. **Do not affect any closing balance** — neither RF nor reserve
4. **Do not affect any finding** — no threshold or validation
   references them
5. **Do not affect monthly payments** — not in any loan or RF rate
   calculation

### `ONE_OFF_PAYMENT` remedy vs `"Sihtmakse"` source

These are **unrelated concepts** that share a name fragment:

| | `ONE_OFF_PAYMENT` | `"Sihtmakse"` |
|---|---|---|
| What | Remedy action kind | Funding source value |
| Where | `policyRuntime.js:64` | `fundingPlan[].source` |
| Does | Patches `openingBalances.repairFundEUR` | Counts toward investment `kaetud` |
| Linked? | **No** — `ONE_OFF_PAYMENT` is an RF shortfall remedy, `"Sihtmakse"` is a per-investment funding source |

### Classification

**`"Toetus"` and `"Sihtmakse"` are correctly aligned.** They are
canonical UI vocabulary values that:
- Appear in the dropdown
- Are stored in `fundingPlan`
- Participate in the canonical coverage calculation
- Have no compute/outflow path — **by design, not by mismatch**

Unlike `"Remondifond"` and `"Laen"` (which have parallel compute
paths that needed vocabulary alignment), `"Toetus"` and `"Sihtmakse"`
have **no compute counterpart at all**. There is nothing to align.

The English values `"GRANT"` and `"ONE_OFF"` are pure legacy —
they exist only in the migration map and are converted to canonical
values on import. They are never created by the UI and never read
by any calculation.

### No action needed

No vocabulary fix, no outflow activation, no new logic required.
These sources are already in their final canonical state.

---

## 17. Investment timing: plannedYear paths after vocabulary audit

### All locations where plannedYear / timing drives planning logic

#### computePlan.js — single-year filter

| # | Line | Code | Input | Output | Affects |
|---|------|------|-------|--------|---------|
| T1 | L162 | `thisYearItems = items.filter(it => N(it?.plannedYear) === year)` | All investments | Investments where `plannedYear === period.year` | **Gate for all downstream compute** |
| T2 | L163–165 | `readyThisYear = thisYearItems.filter(isInvestmentReady).sort(...)` | T1 | READY items for this year, canonical sort | Recommendations only |
| T3 | L166 | `thisYearCount = readyThisYear.length` | T2 | Count | `noteThisYear`, `INV_NONE_THIS_YEAR` |
| T4 | L167 | `costThisYearEUR = thisYearItems.reduce(...)` | T1 | Total cost | Output field |
| T5 | L170 | `rfOutflowThisYearEUR` | T1 | RF outflow | `repairFundClosingEUR` → RF_NEG |
| T6 | L171 | `reserveOutflowThisYearEUR` | T1 | Reserve outflow (inert) | `reserveClosingEUR` (inert) |
| T7 | L172–177 | `loanOutflowThisYearEUR` | T1 | Loan outflow | Output field only |

**Key property:** Only investments with `plannedYear === period.year`
enter the compute pipeline. Investments with future years (year+1,
year+2, year+3) are **completely invisible** to computePlan.js.

#### computeRemondifondiArvutus — all-year, time-aware

| # | Line | Code | Input | Output | Affects |
|---|------|------|-------|--------|---------|
| T8 | L150 | `koikInv = investments` | All investments | No year filter | All RF calculations |
| T9 | L176 | `aasta = inv.plannedYear \|\| periodiAasta` | Per investment | Year for collection | `kogumisaastad` |
| T10 | L177 | `kogumisaastad = Math.max(1, aasta - periodiAasta)` | T9 | Years available to collect | `aastasKoguda`, `maarAastasM2` |
| T11 | L181 | `invDetail.sort((a, b) => a.aasta - b.aasta)` | T9 | Year-sorted detail | Saldo allocation order, display |
| T12 | L188 | `aastasKoguda = koguda / kogumisaastad` | T10 | Annual collection rate | `maarAastasM2` → monthly payments |

**Key property:** ALL investments participate, regardless of year.
Future investments with `plannedYear > periodiAasta` have
`kogumisaastad > 1`, spreading their collection cost over multiple
years. This produces a lower annual rate than a same-year investment.

#### UI — creation and display

| # | Location | What | Year range |
|---|----------|------|-----------|
| T13 | L1895 | Condition-item year dropdown | `[year, year+1, year+2, year+3]` |
| T14 | L2005 | Standalone year dropdown | Same |
| T15 | L1126 | `tegevusAasta` → `plannedYear` sync | Mirrors condition item year to investment |
| T16 | L3536 | Print: condition-item table | Displays `tegevusAasta` |
| T17 | L3563 | Print: standalone table | Displays `plannedYear` |

### The two parallel timing models

**Model 1 — computePlan.js: single-year snapshot**

Only processes `plannedYear === period.year`. Future investments
are invisible. This produces correct outflows and closing balances
for the plan period, but gives no visibility into upcoming years.

Canonical outputs: `costThisYearEUR`, `rfOutflowThisYearEUR`,
`loanOutflowThisYearEUR`, `repairFundClosingEUR`, findings.

**Model 2 — computeRemondifondiArvutus: multi-year accumulation**

Processes ALL investments. Future investments contribute to the
monthly RF rate via `kogumisaastad` time-spreading. This enables
the rate to reflect upcoming obligations, not just current-year.

Canonical outputs: `maarAastasM2`, `laekuminePerioodis`, `saldoLopp`,
`invArvutusread` detail.

### Are these models in conflict?

**No — they serve different purposes and are correctly separate.**

| Concern | Model 1 (computePlan.js) | Model 2 (remondifondi) |
|---------|-------------------------|----------------------|
| Question answered | "What happens to funds this period?" | "What RF rate covers all planned obligations?" |
| Time horizon | Current period only | All planned years |
| Year filter | `plannedYear === year` | None |
| Output consumed by | Closing balances, findings, policy | Monthly payments, RF rate, UI detail |

The RF rate from Model 2 feeds back into Model 1 via the rfRate
sync (useEffect L574): `maarAastasM2/12` → `plan.funds.repairFund.monthlyRateEurPerM2`
→ `repairFundIncomePeriodEUR` in computePlan.js. This creates a
coherent loop:
- Model 2 computes the rate needed to cover all years
- Model 1 uses that rate to compute this-period income
- Model 1 deducts this-period outflow to get closing balance

### Remaining timing concern: future-year outflows

An investment with `plannedYear = 2028` (3 years out):
- **Model 2:** Included. `kogumisaastad = 3`. Rate spreads the
  cost over 3 years of collection. Correct.
- **Model 1:** Not included (planned year ≠ period year). When
  the user creates next year's plan (period 2028), the investment
  will appear as `thisYearItem` and its outflow will be deducted.

This is the **single-year model assumption** (documented in
section 6.1). It means the plan only shows closing balances for
the current period — it does not project fund balances into
future periods. The RF rate accounts for future needs, but the
closing balance does not show the future deduction.

This is a **design limitation**, not a bug. A multi-year closing
balance projection would be a new feature, not a vocabulary fix.

### Status after vocabulary audit

All timing paths are on their canonical rail:

| Path | Status | Reason |
|------|--------|--------|
| T1–T7 (computePlan.js) | **CANONICAL** | thisYearItems uses correct year filter, READY filter for recommendations, outflows use canonical vocabulary |
| T8–T12 (remondifondi) | **CANONICAL** | All-year processing with time-spreading, year-sorted detail |
| T13–T17 (UI) | **CANONICAL** | Year dropdowns offer plan year + 0–3, sync to `plannedYear` |

No inert, legacy, or mismatched timing paths remain.

---

## OPEN QUESTIONS

### Q0: Loan validation linkage direction

computePlan.js loan validation (L303–316) expects `fundingPlan`
entries to have a `loanId` field pointing to the loan. The UI
uses the inverse: `loan.sepiiriostudInvId` points to the
investment.

**Options:**
1. Add `loanId` to UI-created fundingPlan entries when loan is
   synced (align UI with compute model)
2. Rewrite L303–316 to use `sepiiriostudInvId` lookup (align
   compute with UI model)
3. Remove L303–316 entirely (loan integrity is already checked
   by `planConsistency.js:44` using the UI model)

**Decision needed** before loan vocabulary can be unified.

### Q1: Legacy data with RESERVE → Remondifond mapping

Existing saved plans may contain investments whose `fundingPlan`
originally had `source: "RESERVE"` and was migrated to
`"Remondifond"` on import (L876). These are now indistinguishable
from genuinely repair-fund-funded investments. The original semantic
distinction is lost.

**Impact:** If the system later adds a `"Reservkapital"` funding
source, there is no way to retroactively fix these entries.

**Decision needed:** Is this acceptable data loss, or should a
future migration attempt to distinguish them (e.g., by checking
import timestamps or original source metadata)?

### Q2: Same-year ordering in remondifondi saldo allocation

#### Where it happens

`computeRemondifondiArvutus` → inner `computeRF` function
(majanduskavaCalc.js L169–190).

#### Current sort rule

```js
invDetail.sort((a, b) => a.aasta - b.aasta)    // L181
```

**Primary key:** `aasta` (= `inv.plannedYear || periodiAasta`) ASC.
**Same-year tie-break:** none. Array.sort is stable in V8, so
same-year items retain their position from the input array.

#### What determines the input order

```
caller: computeRemondifondiArvutus({ investments, ... })
         ↓
investments = plan.investments.items    (MajanduskavaApp.jsx L504)
         ↓
koikInv = investments                    (majanduskavaCalc.js L150)
kindladInv = koikInv.filter(...)         (L153)
         ↓
computeRF(koikInv, ...) or computeRF(kindladInv, ...)   (L253–254)
```

`plan.investments.items` is in **insertion order** — the order in
which the user created or imported investments. No sort is applied
between the React state array and the `computeRF` input.

`kindladInv` is a `.filter()` of `koikInv`, which preserves
relative order of surviving elements.

#### Why same-year order matters

The saldo allocation loop (L183–190) is sequential:

```
let jaakSaldo = saldoAlgus;
for each d in invDetail (sorted):
  saldost = min(jaakSaldo, d.rfSumma)    ← first item gets saldo priority
  jaakSaldo -= saldost
  koguda = rfSumma - saldost             ← less collection needed
  aastasKoguda = koguda / kogumisaastad
```

When two investments share the same year, whichever comes first
consumes opening balance. The second must collect more via monthly
rate. This changes per-investment `saldost`, `koguda`, and
`aastasKoguda` values.

#### Impact on aggregate outputs

| Output | kogumisViis "eraldi" | kogumisViis "uhine" |
|--------|---------------------|---------------------|
| `investRemondifondist` | Order-independent (sum) | Order-independent (sum) |
| Per-inv `saldost` | **Order-dependent** | **Order-dependent** |
| Per-inv `koguda` | **Order-dependent** | **Order-dependent** |
| Per-inv `aastasKoguda` | **Order-dependent** | **Order-dependent** |
| `totalAastaVajadus` (sum of aastasKoguda) | **Order-independent** ¹ | N/A |
| `totalKoguda` (sum of koguda) | **Order-independent** ¹ | **Order-independent** ¹ |
| `maarIlmaLaenuta` | **Order-independent** ¹ | **Order-independent** ¹ |
| `maarAastasM2` | **Order-independent** ¹ | **Order-independent** ¹ |
| UI detail table rows | **Order-dependent** | **Order-dependent** |

¹ The sums are order-independent because `saldost + koguda = rfSumma`
for each investment, and `sum(saldost) + sum(koguda) =
sum(rfSumma)`. Redistributing saldo between same-year items changes
individual `koguda` values but not the total. The `aastasKoguda`
sum stays the same because all same-year items share the same
`kogumisaastad` divisor.

**Net effect:** The final `maarAastasM2` rate is deterministic
regardless of same-year order. But the per-investment detail rows
displayed in the UI (`invArvutusread`) show different `saldost` and
`koguda` splits depending on insertion order.

#### LEGACY: current same-year behavior

The current same-year order is **insertion order** — a side effect
of Array.sort stability, not a design choice. It is non-deterministic
from the user's perspective: the same set of investments can produce
different per-investment detail rows depending on when each was
created.

#### CANONICAL: proposed same-year tie-break

Apply the existing canonical investment sort as a secondary key:

```
invDetail.sort((a, b) =>
  a.aasta - b.aasta                           // primary: year ASC
  || b.rfSumma - a.rfSumma                    // secondary: larger RF amount first
  || (a.nimetus || "").localeCompare(b.nimetus) // tertiary: name ASC
)
```

**Rationale for rfSumma DESC:** The larger repair fund need should
consume opening balance first. This matches the financial intuition
that the biggest obligation gets saldo priority — it minimizes the
per-m² collection rate for the largest item, reducing sticker shock
in the detail table. It also aligns with the canonical
`totalCostEUR DESC` sort used elsewhere, applied here to the
RF-specific amount.

**Rationale for nimetus ASC:** Deterministic alphabetical fallback,
consistent with the canonical `name ASC` tertiary key.

**Behavior change if applied:** Per-investment `saldost` / `koguda`
detail rows would change for same-year investments. The aggregate
`maarAastasM2` rate would NOT change (proven order-independent).
This is a display-only change to the RF detail table.

#### Decision status

Not yet applied. The canonical tie-break is proposed but requires
confirmation before implementation, because:

1. The per-investment detail table is user-visible — changing row
   values could confuse users who have memorized current numbers.
2. The aggregate rate is unaffected, so there is no correctness
   urgency.
3. An alternative tie-break (e.g. `kogumisaastad ASC` — shorter
   collection period first) is also defensible.

### Q3: BLOCKED investment outflow contribution

A BLOCKED-overfunded investment contributes its full (overfunded)
amount to outflows. For example, if totalCostEUR=30000 but
fundingPlan has REPAIR_FUND=40000, the rfOutflow contribution is
40000 — not capped at 30000. This could cause an artificial RF_NEG
finding that would resolve if the user fixes the overfunding.

**Severity:** Low. The UI shows the BLOCKED red signal. The user is
expected to fix the data before relying on closing balance figures.

---

## Branch summary

### Resolved: Remondifond planning/outflow/closing/finding path

1. **Source vocabulary unified** — `computePlan.js` rfOutflow matches
   `"Remondifond"` (canonical UI value), not the inert `"REPAIR_FUND"`.
   Outflow is now active for UI-created investments.
2. **Opening balance synced** — `remondifond.saldoAlgus` (React state)
   syncs to `plan.openingBalances.repairFundEUR` via useEffect.
   `computePlan.js` closing balance now uses the user-entered saldo.
3. **RF_NEG finding active** — negative `repairFundClosingEUR`
   triggers `RF_NEG` finding in `computePlan.js` and downstream
   Solvere evaluation. Previously inert (outflow always 0, opening
   always 0).
4. **Regression-tested** — closing balance value and RF_NEG finding
   locked by tests in `investmentOutflowRegression.test.js`.

### Still out of scope: Reserve capital (feature-gap)

1. **Opening balance not synced** — `resKap.saldoAlgus` does not
   sync to `plan.openingBalances.reserveEUR` (always 0).
2. **No reserve funding source** — UI dropdown has no
   `"Reservkapital"` option. `reserveOutflowThisYearEUR` is always 0.
3. **`RES_NEG` inert** — cannot trigger (`reserveClosingEUR` =
   `plannedEUR` ≥ 0 always). Correctly implemented, awaiting data path.
4. **`"LOAN"` vocabulary** — `computePlan.js` still uses `"LOAN"`,
   UI uses `"Laen"`. Loan outflow remains inert. Not addressed in
   this branch.

### Next subtopic

Loan source vocabulary unification (`"LOAN"` → `"Laen"` in
`computePlan.js`) and loan validation alignment in the
recommendation loop.
