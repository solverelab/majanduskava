# PROJECT_STATUS.md

Projekti seis: 2026-02-27

## 1. Mis on tehtud

### Solvere Core Contract v1 (frozen)

`src/solvereBridge/majanduskavaHost.js` deklareerib formaalse lepingu:

1. Deterministlik runtime — sama state + policyVersion → sama evaluation fingerprint, loopGuard, policyVersion
2. TRACE/v1 invariant — evaluation.trace peab olema schemaVersion "trace/v1", events array, non-empty policyVersion
3. Action chain ordering — finding → actionCandidate → actionSelected → actionApplied (downstream ilma upstream'ita keelatud)
4. autoResolve contract — steps on array, iga step sisaldab evaluationSnapshotBefore/After
5. No nondeterministic fields — trace ei tohi sisaldada timestamp/time/date/now/generatedAt/createdAt/updatedAt
6. stateSignature + reportDigest stability — content hashid on deterministlikud ja key-order-sõltumatud

Breaking changes nõuavad explicit v2 version bump'i.

### actionCandidates kiht

- **`ActionCandidateV1`** interface lisatud `solvereCoreV1.ts`-i: `candidateId`, `findingId`, `findingCode`, `actionCode`, `action` (täis ActionV1), `riskScoreDelta`, `isEligible`, `rank`
- **`buildActionCandidates()`** (`buildActionCandidates.ts`) — puhas funktsioon, mis itereerib `evaluation.findings[].actions[]` ja ehitab flat `actionCandidates[]` listi. Lisab `kind: "actionCandidate"` trace event'id koos `rankVector`-iga.
- **Pipeline järjekord** `moduleHost.ts`-s: `evaluatePolicy → resolveActions → withActionImpacts → buildActionCandidates → policyVersion → assertEvaluationContract`. Trace propageeritakse eksplitsiitselt läbi pipeline.
- `EvaluationV1`-le lisatud `actionCandidates?: ActionCandidateV1[]`, `trace?: EvaluationTraceV1`, `policyVersion?: string`
- Trace event'ide järjekord on deterministlik: sorted `candidateId ASC`

### rankVector-põhine selection

- **`RankVector`**: `{ primary: riskScoreDelta, secondary: actionCode, tertiary: candidateId }`
- Sortimisreegel: primary ASC → secondary ASC → tertiary ASC (täielikult deterministlik)
- `tieBreakUsed: boolean` — `true` kui mitu candidate'i jagavad sama primary väärtust
- `reasonCode: "LOWEST_PRIMARY_RANK"`
- rankVector on ka `actionCandidate` trace event'ides (explainable ranking)

### CandidateEligibilityReason ja annoteeritud candidate'id

- **`CandidateEligibilityReasonV1`** tüüp: `"ELIGIBLE"`, `"FILTERED_BY_SEEN"`, `"MISSING_INPUT"`, `"CONFLICTS_WITH_PRESET"`, `"NOT_APPLICABLE"`, `"BLOCKED_BY_CONTRACT"`
- **`AnnotatedCandidate`** — candidate + `eligible: boolean` + `reasons: CandidateEligibilityReason[]`
- `pickFromCandidates` annoteerib **kõik** candidate'id enne selection'i:
  - `isEligible === false` → `eligible: false, reasons: ["NOT_APPLICABLE"]`
  - `isEligible === true` aga seenKey on seen-setis → `eligible: false, reasons: ["FILTERED_BY_SEEN"]`
  - `isEligible === true` ja pole seen → `eligible: true, reasons: ["ELIGIBLE"]`
- Selection toimub ainult `eligible === true` candidate'ide seast
- NO_CHOICE korral `stop.details.candidateReasons[]` sisaldab iga candidate'i annotatsioone
- Trace event'id sisaldavad kõiki candidate'e (nii eligible kui ineligible) koos `reasons`-iga

### Evaluation snapshots

- **`EvaluationSnapshot`**: `{ riskScore, riskLevel, findingsCount, findingCodes (sorted ASC), actionCandidatesCount }`
- `buildEvaluationSnapshot()` funktsioon `moduleHost.ts`-s
- Step'id sisaldavad `evaluationSnapshotBefore` / `evaluationSnapshotAfter` (mitte täisobjekte)
- `delta: { riskScore, findingsCount }` — arvutuslikud deltad
- `isProgress` — deterministlik: `sigAfter !== sigBefore && (riskScoreDelta < 0 || findingsCountDelta < 0)`
- Trace, evidence, metrics EI salvestata step'i

### State signature

- **`buildStateSignature(state)`** (`moduleHost.ts`) — deterministlik, key-order-sõltumatu content hash
- Kasutab `deepCloneWithSortedKeys()` (rekursiivne sorted-key deep clone, arrays säilitavad järjekorra) + `canonicalStringify()` + kaks FNV-1a hashi (64-bit efektiivne kollisioonikindlus)
- Dev-mode assertion: kontrollib et canonical ja raw path annavad sama tulemuse
- Tagastab 16-kohaline hex string
- Ei kasuta timestamp'e, runtime ID-sid ega mitte-deterministlikke allikaid
- Iga step sisaldab `stateSignatureBefore` ja `stateSignatureAfter`
- **State signature override**: kui `stateSignatureAfter === stateSignatureBefore` → `isProgress = false` → `stop.reason = "NO_PROGRESS"` **sõltumata** risk/findings loogikast

### policyVersion

- **`buildPolicyVersion(bundle)`** (`moduleHost.ts`) — deterministlik content hash policy bundle'ist
- Sama `canonicalStringify()` + FNV-1a muster nagu `buildStateSignature`
- Lisatakse `evaluation.policyVersion`-ile `run()` pipeline'is enne `assertEvaluationContract`-i
- Lisatakse `RunReportV1.policyVersion`-ile `autoResolveWithHost`-is (ekstraheeritakse initial evaluation'ist)
- `assertEvaluationContract` nõuab `policyVersion` olemasolu (viskab vea kui puudub)

### reportDigest

- **`buildReportDigest(report)`** (`autoResolve.ts`) — deterministlik content hash RunReportV1 sisust
- Sisaldab: `policyVersion`, `preset`, `initial`, `final`, `stepsTaken`, `stop`, `selectedActionCodes`
- Sama `stableStringify()` + FNV-1a muster
- `report.reportDigest` — 16-kohaline hex string
- Muutub kui muutub ükskõik milline sisendväli
- Arvutatakse `autoResolveWithHost`-is pärast report'i ehitamist, enne consistency check'i

### seenKey loop guard

- **`seenKey`** = `candidateId + "::" + canonicalizePatch(patch)`
- **`canonicalizePatch()`** (`moduleHost.ts`) — sorteerib patch operations deterministlikult (op, path, value); sama sisuga patch erineva järjekorraga → alati sama string
- `pickFromCandidates` filtreerib seenKey järgi (mitte candidateId järgi)
- Iga step sisaldab `loopGuard: { seenKey, seenCountBefore, seenCountAfter }`
- Kui kõik eligible candidate'd on seen → `stop.reason = "NO_CHOICE"` koos `details: { candidatesEligible, filteredBySeenCount, seenKeys, seenCount, candidateReasons }`

### assertEvaluationContract

- **`assertEvaluationContract(evaluation)`** (`moduleHost.ts`) — valideerib pipeline väljundit:
  - `evaluation.schemaVersion === "evaluation/v1"`
  - `evaluation.policyVersion` on olemas ja non-empty string
  - `trace.schemaVersion === "trace/v1"` ja `trace.events` on array
  - `actionCandidates[]` kohustuslikud väljad: `candidateId`, `findingId`, `action.code`
  - `risk.score` on number, `risk.level` on string
  - Nondeterministlike võtmete puudumine trace'is ja candidates'is (timestamp, time, date, random, uuid, nonce, seed, createdAt, updatedAt, generatedAt)
- **`EvaluationContractError`** koodiga `E_EVAL_CONTRACT_VIOLATION` ja `details: { missing, nondeterministic }`
- Kutsutakse `run()` meetodis pärast `buildActionCandidates` ja `policyVersion` lisamist

### assertModuleContract

- **`assertModuleContract(evaluation)`** (`moduleHost.ts`) — varajane pipeline kontroll enne autoResolve:
  - `evaluation.schemaVersion === "evaluation/v1"`
  - `evaluation.policyVersion` on olemas ja non-empty string
  - `trace.schemaVersion === "trace/v1"`
- **`ModuleContractError`** koodiga `E_MODULE_CONTRACT_VIOLATION` ja `details: { violations: string[] }`
- Kutsutakse `run()` meetodis pärast `_computingImpacts` guard'i (ainult põhiteel, mitte impact simulation'i ajal)

### assertRunReportConsistency

- **`assertRunReportConsistency(report, steps)`** (`moduleHost.ts`) — deterministlik kontroll:
  - `stepsTaken > 0`: `report.final.stateSignature === steps[last].stateSignatureAfter`
  - `stepsTaken === 0`: `report.final.stateSignature === report.initial.stateSignature`
- **`RunReportInconsistentError`** koodiga `E_RUN_REPORT_INCONSISTENT` ja `details: { expected, actual, rule }`
- Kutsutakse `autoResolveWithHost` lõpus pärast report'i ehitamist

### Development-mode nondeterminism guard

- **`NondeterministicSourceError`** koodiga `E_NONDETERMINISTIC_SOURCE_USED` ja `details: { tampered: string[] }`
- `run()` meetodis, kui `NODE_ENV !== "production"`: salvestab `Date.now` ja `Math.random` viited enne `compute`/`evaluate`/`resolveActions`, kontrollib pärast et viited pole muutunud
- Ei muuda production käitumist, ei lisa mitte-deterministlikke välju report'i
- `IS_DEV` arvutatakse mooduli tasemel üks kord (`typeof process !== "undefined" && process.env?.NODE_ENV !== "production"`)

### Dev-only runtime guard'id (solvereBridge)

`src/solvereBridge/majanduskavaHost.js` sisaldab 8 dev-only runtime kontrolli:

**Master switch**: `SOLVERE_DEV_GUARDS_ENABLED = IS_DEV && true` — üks keskne konstant, mis kontrollib kõigi guard'ide aktiveerimist. Väljalülitamiseks muuda `&& true` → `&& false`.

**Diagnostika**: `export const __DEV_GUARDS_STATUS__ = { enabled: SOLVERE_DEV_GUARDS_ENABLED }` — staatiline boolean-objekt testide ja debugimise jaoks (ei kasutata UI-s ega trace'is).

Guard'id `runPlan()` ja `applyActionAndRun()` sees (järjekorras):

1. **`assertTraceV1Invariant(evaluation)`** — kontrollib `trace` olemasolu, `trace.schemaVersion === "trace/v1"`, `trace.events` on array, `evaluation.policyVersion` on non-empty string. Error: `TRACE_V1_INVARIANT_FAILED`
2. **`assertNoNondeterministicFields(trace)`** — rekursiivne walk läbi `evaluation.trace`, otsib keelatud võtmeid (case-insensitive): timestamp, time, date, now, generatedAt, createdAt, updatedAt. Error: `NONDETERMINISM_FIELD_FOUND`
3. **`assertPolicyVersionStability(state, evaluation)`** — cache'ib `policyVersion` per `stateSignature`. Sama state peab alati andma sama policyVersion. Cache tühjendatakse `setPreset()` kutsel. Error: `DETERMINISM_FAILED: policyVersion changed`
4. **`assertDeterminismStability(state, evaluation)`** — cache'ib evaluation fingerprint (`risk|level|findingCodes|candidateCount`) per `stateSignature::policyVersion`. Sama sisend peab alati andma sama väljundi. Error: `DETERMINISM_FAILED: evaluation fingerprint mismatch`
5. **`assertLoopGuardStability(state, evaluation)`** — cache'ib eligible candidate count per `stateSignature::policyVersion`. `"OK:n"` vs `"BLOCKED:0"` peab olema stabiilne. Error: `DETERMINISM_FAILED: loopGuard mismatch`
6. **`assertActionChainCompleteness(evaluation)`** — valideerib action chain ordering invariant per finding: finding → actionCandidate → actionSelected → actionApplied. Keelab downstream ilma upstream'ita. Nõuab `isEligible` boolean'i igalt candidate'ilt. Error: `TRACE_ACTION_CHAIN_INVARIANT_FAILED`
7. **`deepFreeze(evaluation)`** — rekursiivne `Object.freeze` evaluation objektile, et UI ei saaks muteerida

Guard `runAutoResolve()` sees:

8. **`assertAutoResolveContract(result)`** — valideerib et `steps` on array ja iga step sisaldab `evaluationSnapshotBefore` + `evaluationSnapshotAfter`. Error: `AUTORESOLVE_CONTRACT_FAILED`

Kõik cache'd on module-scope `Map`-id (mitte localStorage), piiratud 200 kirjele (FIFO eviction).

### RunReport (runReport/v1)

- **`RunReportV1`** — autoResolve kokkuvõte:
  - `schemaVersion: "runReport/v1"`
  - `moduleId`, `preset?`, `policyVersion?`, `reportDigest?`
  - `initial: { stateSignature, riskScore, findingsCount }`
  - `final: { stateSignature, riskScore, findingsCount }`
  - `stepsTaken`
  - `stop: { reason, details? }`
  - `selectedActionCodes: string[]` (järjekorras, step 0, 1, 2...)
- `autoResolveWithHost` tagastab `report: RunReportV1` top-level väljana
- Report on kokkuvõte; `steps[]` jääb eraldi detailvaateks

### Step trace struktuur (stepTrace/v1)

Iga `AutoResolveStep` sisaldab:
- `schemaVersion: "stepTrace/v1"`
- `index` (mitte `step`)
- `stateSignatureBefore` / `stateSignatureAfter`
- `evaluationSnapshotBefore` / `evaluationSnapshotAfter`
- `delta: { riskScore, findingsCount }`
- `isProgress: boolean`
- `actionSelected: { candidateId, reasonCode, rankVector, tieBreakUsed }`
- `actionApplied: { actionCode, kind, patch }`
- `loopGuard: { seenKey, seenCountBefore, seenCountAfter }`

### Trace event'id (evaluation.trace.events)

Trace sisaldab ainult pipeline event'e (EI autoResolve resolve-event'e):
- `kind: "finding"` — evaluatePolicy poolt
- `kind: "actionCandidate"` — buildActionCandidates poolt (koos `eligible`, `reasons`, `rankVector`-iga)

Trace event'ide järjekord:
- `actionCandidate` event'id sorted `candidateId ASC`
- Kõik candidate'id (nii eligible kui ineligible) saavad event'i

AutoResolve explainability elab step'ides, mitte trace'is.

### Tüübid (src/policy/trace/traceV1.ts)

- `EvaluationSnapshotV1`
- `LoopGuardV1`
- `RankVectorV1`
- `CandidateEligibilityReasonV1`
- `StepTraceV1` (koos stateSignatureBefore/After)
- `AutoResolveStopDetailsV1` (seenKeys, seenCount, threshold, candidatesEligible, filteredBySeenCount)
- `AutoResolveStopV1` (reason, stepsTaken, details?)
- `AutoResolveResultV1` (koos report?: RunReportV1)
- `RunReportV1` (koos policyVersion?, reportDigest?)

### UI: Visuaalne disain ja layout

**Soe neutraalne palett** — "paber laual" esteetika:
```
N.bg="#f0eeeb" (lehe taust, soe kivi)
N.surface="#ffffff" (kaart / vorm)
N.muted="#f7f6f4" (sekundaarne pind)
N.border="#e0ddd8" (kaardi äär, eraldajad)
N.rule="#e5e2de" (tabeli/rea eraldajad)
N.text="#2c2825" (põhitekst, soe must)
N.sub="#5c554d" (sekundaarne tekst)
N.dim="#9b9389" (tertsiaarne / tuhm tekst)
N.accent="#3b3632" (primaarne nupp, soe tume)
N.sidebar="#3d3835" (sidebar'i taust)
```

**Vertikaalne sidebar navigatsioon**:
- 7 tabi: Periood & korterid, Investeeringud, Kulud, Tulud, Fondid & laen, Korterite maksed, Kontroll & kokkuvõte
- Iga tabi kõrval staatuse-indikaator (dot): `empty` (tühi/hall), `partial` (poolik/kollane), `done` (täidetud/roheline)
- Aktiivne tab: valge-tooniga esiletõst + kuldne vasakäär (`#c4b08a`)

**Tab-kohane "Tühjenda" nupp**:
- Iga tabi päises lingistiilne "Tühjenda" nupp, mis kustutab ainult selle jaotise andmed
- `clearSection(tabIdx)` handler koos confirm dialoogiga

### UI: Periood & KÜ andmed (Tab 0)

**Perioodi sisestus — 3 dropdowni per kuupäev (PP/KK/AAAA)**:
- `periodParts` state: `{ sd, sm, sy, ed, em, ey }` — eraldi UI state mis säilitab iga dropdown'i väärtuse
- Sync `plan.period.start/end` (ISO string) ainult kui kõik 3 osa täidetud
- Auto-end: alguskuupäeva valimisel seatakse lõpp automaatselt aasta lõppu
- Kuupäeva tekst kuvatakse otse `periodParts`-ist (mitte `plan.period`-ist)

**KÜ andmed**:
- `kyData` state: `{ nimi, registrikood, aadress }` — eraldi top-level state
- Kaasatakse JSON eksporti/importi: `bundle.kyData`
- Kuvatakse prindi päises (nimi + registrikood · aadress)
- Tühjendatakse Tab 0 kustutamisel

### UI: Automaatne tühirida ja "Lisa" nupud

- `useEffect` auto-add: kui sektsiooni array on tühi, lisatakse automaatselt üks tühi rida (korterid, investeeringud, kulud, tulud, laenud)
- "+ Lisa" nupud asuvad tabeli/loendi all (mitte sektsiooni päises)

### UI: Protsendiväljad (PctInput komponent)

- **`PctInput`** komponent — lokaalse string-state'iga sisend Eesti komakohaga
- `type="text"` + `inputMode="decimal"` (mobiilil numpad komaga)
- Sisestamisel säilitab koma; `onBlur` teeb `parseFloat` ja salvestab numbri
- Kuvamisel näitab koma (`.` → `,`)
- Kasutuses: `annualRatePct`, `reservePct` laenude sektsioonis

### UI: Risk-info gating

- `showTechnicalInfo` toggle — "Kaalutud skoor" ja "Risk -1/+2" badge'id peidetud vaikimisi
- Section komponent saab `showTechnicalInfo` prop'i

### UI (TracePanel.jsx)

- **Rule trace**: finding event'id grupeeritud `findingCode ASC`, iga finding'u all `actionCandidate` event'id sorted `candidateId ASC`
- Iga candidate näitab: `actionCode`, `eligible` (roheline/punane), `reasons` (badge'id), `rankVector.primary`
- Kasutab ainult `trace.events` andmeid (mitte evaluation objekti tuletusi)
- **Solver steps**: andmepõhine renderdamine step'ide struktuurist
- Näitab: candidate ID, rankVector (primary/secondary/tertiary), tie-break märge, action code, kind
- **State signature**: iga step näitab `stateSignatureBefore → stateSignatureAfter`; kui võrdsed → punane badge **STATE_UNCHANGED**
- Snapshot deltad värvikoodidega (roheline = paranemine)
- Stop reason eestikeelse label'iga
- "Näita patch" detailvaade `actionApplied.patch`-ist

### UI: Tab 6 visuaalne struktuur

Tab 6 ("Kontroll & kokkuvõte") on jagatud kolmeks visuaalseks plokiks:

**A) Vastavuse kokkuvõte** (sinine äär):
- loopGuard status badge (OK / BLOCKED, tuletatud `evaluation.actionCandidates` eligible count'ist)
- RunReport kokkuvõte badge (OK / Tähelepanu vajab / Andmed puuduvad)
- "Prindi kokkuvõte" nupp

**B) Ekspordi / impordi** (roheline äär):
- "Salvesta fail" nupp — ExportBundle: `{ schemaVersion: "majanduskavaExport/v1", moduleId, preset, policyVersion, stateSignature, state, kyData }`
- "Ava fail" nupp — import koos dry-run valideerimisega (taastab ka `kyData`)
- Skeemiversiooni veateade (kui import ebaõnnestub)

**C) Süsteemi info** (hall äär, muted toon):
- policyVersion, reportDigest, stateSignature
- Helehall taust, väiksem font

### UI: JSON import dry-run

Import handler teostab deterministliku dry-run valideerimise enne state'i asendamist:

1. **Parse** — `JSON.parse`
2. **Guard** — `majanduskavaExport/v1` (composite või split `type + version`) + `moduleId` + `state` olemasolu
3. **Dry-run** — `runPlan(candidateState)` (läbib kõik dev-guard'id)
4. **Trace kontroll** — `evaluation.trace` olemas ja `schemaVersion === "trace/v1"`
5. **Commit** — alles siis: `setPlan`, `setEvaluation`, `setSolvereMetrics`, preset, `setKyData`
6. **Error** — kui dry-run ebaõnnestub, state ei muutu; veateade Tab 6 sees

### UI: autoResolve bridge wrapper

- `autoResolve` import MajanduskavaApp.jsx-s asendatud `runAutoResolve`-ga bridge'ist
- `runAutoResolve(args)` kutsub `autoResolve(args)` + dev-režiimis `assertAutoResolveContract(result)`
- Kõik autoResolve kutsed lähevad nüüd läbi bridge'i

### UI: Pilot-checklist ja tagasiside

- **Pilot launch checklist** — 6 staatilist kontrollpunkti Tab 6 ülaosas
- **Kasutustest (dev) — tagasiside mall** — eelformaaditud mall 9 väljaga, "Kopeeri tagasiside mall" nupp (clipboard API + fallback), secondary stiil (hall äär)

### Deploy seadistus

- `vite.config.js`: `base: '/majanduskava/'` (GitHub Pages alamkaust)
- `package.json`: `"deploy": "npm run build && gh-pages -d dist"` (build enne deploy'i)
- `README.md`: Majanduskava Launch Protocol v1 (6-sammuline kontroll-loend)

## 2. Mis on pooleli / tegemata

- **Ühtegi pooleliolevat ülesannet ei ole.** Kõik nõutud muudatused on implementeeritud.
- Potentsiaalsed edasiarendused (pole veel küsitud):
  - `canonicalizePatch` unit testid eraldi failina
  - Multi-step undo/redo tugi
  - CI/CD pipeline (GitHub Actions)

## 3. Testide seis

**33/33 testi läbivad (0 failed)**

| Testifail | Testide arv | Staatus |
|-----------|-------------|---------|
| `determinism.test.ts` | 1 | PASS |
| `policyRuntime.test.js` | 12 | PASS |
| `majanduskava.e2e.test.ts` | 5 | PASS |
| `autoResolve.test.ts` | 15 | PASS |

### autoResolve.test.ts testid (15):

1. **same patch key order stability** — legacy actions, sama patch erineva key-järjekorraga → sama action key
2. **distinct patches allowed** — erinevad patch'id → erinevad sammud lubatud
3. **LOOP_GUARD/NO_CHOICE when same candidate re-selected** — sama candidate+patch → NO_CHOICE, `filteredBySeenCount === candidatesEligible`
4. **stable seenKey regardless of patch key order** — canonical seenKey ei sõltu key-järjekorrast
5. **next eligible candidate when first is seen** — A (rank -3) on seen → valitakse B (rank -2)
6. **NO_PROGRESS when state signature unchanged** — apply ei muuda state'i → `isProgress = false` sõltumata risk deltast
7. **runReport/v1 consistency (stepsTaken > 0)** — `final.stateSignature === steps[last].stateSignatureAfter`, `selectedActionCodes[i] === steps[i].actionApplied.actionCode`
8. **runReport/v1 consistency (stepsTaken === 0)** — `final.stateSignature === initial.stateSignature`, `selectedActionCodes === []`
9. **preset affects runReport output** — erinev preset → erinev `stepsTaken`, `selectedActionCodes`, `stateSignature`; `report.preset` vastab kasutatud preset'ile
10. **idempotent** — re-run final state'il → 0 sammu, NO_ACTIONS
11. **determinism** — kaks identset jooksu annavad täpselt sama tulemuse (state, evaluation, steps)
12. **replay determinism** — kaks identset jooksu → identsed report'id (stateSignature, selectedActionCodes, stop.reason)
13. **schemaVersion contract** — kontrollib `evaluation/v1`, `trace/v1`, `stepTrace/v1`, `runReport/v1`
14. **golden-trace snapshot** — fikseeritud input, serialiseeritud snapshot (report + steps + candidateEvents) → täpne võrdlus inline GOLDEN objektiga; sisaldab `policyVersion` ja `reportDigest` kontrolli
15. **JSON round-trip serializable** — `JSON.stringify` → `JSON.parse` round-trip; kontrollib report.schemaVersion, final.stateSignature, selectedActionCodes, steps.length, steps[i].stateSignatureAfter, reportDigest

## 4. Failide struktuur

```
packages/solvere-core/src/
  index.ts              — ekspordi hub (kõik public API)
  solvereCoreV1.ts      — põhitüübid (ActionV1, FindingV1, EvaluationV1, ActionCandidateV1 jne)
  moduleHost.ts         — createModuleHost, buildEvaluationSnapshot, buildStateSignature,
                          buildPolicyVersion, canonicalizePatch, deepCloneWithSortedKeys,
                          assertEvaluationContract, assertModuleContract,
                          assertRunReportConsistency, NondeterministicSourceError (dev-mode guard)
  autoResolve.ts        — autoResolve loop (rankVector, seenKey, snapshots, stateSignature,
                          AnnotatedCandidate, CandidateEligibilityReason, RunReportV1,
                          buildReportDigest)
  buildActionCandidates.ts — actionCandidates[] ehitamine + trace events (sorted candidateId ASC)
  computeActionImpact.ts — withActionImpacts (riskScoreDelta arvutamine)
  applyPatch.ts         — patch rakendamine (set/increment/decrement)
  evaluateRisk.ts       — riski hindamine (low/medium/high)
  registry.ts           — FINDING_CODES, ACTION_CODES, PRESET_CODES

solvere-modules/majanduskava/src/
  runtime.ts            — createMajanduskavaRuntime()
  evaluatePolicy.ts     — findings + trace genereerimine
  compileRemedies.ts    — remedy → ActionV1 kompileerimine
  policyLoader.ts       — YAML preset'ide laadimine
  manifest.ts           — mooduli manifest
  types.ts              — PlanState, PlanMetrics

src/solvereBridge/
  majanduskavaHost.js   — Solvere Core Contract v1 (frozen)
                          bridge: createModuleHost + SOLVERE_DEV_GUARDS_ENABLED master switch
                          + __DEV_GUARDS_STATUS__ diagnostika eksport
                          + runAutoResolve wrapper (autoResolve + contract assert)
                          + 8 dev-only runtime guard'i:
                            runPlan/applyActionAndRun: traceV1 invariant,
                            noNondeterministicFields, policyVersion stability,
                            determinism stability, loopGuard stability,
                            actionChainCompleteness, deepFreeze
                            runAutoResolve: autoResolveContract

src/policy/trace/
  traceV1.ts            — kõik trace tüübid (TraceV1, StepTraceV1, EvaluationSnapshotV1,
                          CandidateEligibilityReasonV1, RunReportV1, AutoResolveResultV1 jne)

src/components/
  TracePanel.jsx        — trace/step visualiseerimine (grupeeritud finding → candidates,
                          stateSignature, snapshots, rankVector)

src/MajanduskavaApp.jsx — monolitne UI (~1750 rida), vertikaalne sidebar nav,
                          soe neutraalne palett, periodParts + kyData state,
                          PctInput komponent (koma-decimal), tab-kohane tühjendamine,
                          automaatne tühirea lisamine, Tab 6 kolme-ploki struktuur,
                          dry-run import valideerimisega, autoResolve läbi bridge'i

src/policy/__tests__/
  autoResolve.test.ts   — 15 testi (seenKey, ranking, eligibility, stateSignature, runReport,
                          preset, idempotency, determinism, schemaVersion, golden snapshot,
                          JSON serializable)
  determinism.test.ts   — 1 test (täielik determinism)
  majanduskava.e2e.test.ts — 5 testi (e2e pipeline)
  policyRuntime.test.js — 12 testi (legacy policy engine)
```
