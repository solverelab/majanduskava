# PROJECT_STATUS.md

Projekti seis: 2026-02-27

---

## 1. Mis on tehtud

### Solvere Core framework (packages/solvere-core/)

| Komponent | Fail | Kirjeldus |
|-----------|------|-----------|
| **moduleHost** | `moduleHost.ts` (16KB) | Orkestraator: `createModuleHost()`, `buildStateSignature()` (FNV-1a), `buildPolicyVersion()`, `buildEvaluationSnapshot()`, deterministlikkuse kontrollid |
| **autoResolve** | `autoResolve.ts` (18KB) | Loop: `pickFromCandidates()` rankVector-ranking (riskScoreDelta ASC → actionCode ASC → candidateId ASC), seenKey loop guard, max 10 sammu, 5 stop-reason'it (NO_ACTIONS, NO_CHOICE, LOOP_GUARD, NO_PROGRESS, MAX_STEPS) |
| **actionCandidates** | `buildActionCandidates.ts` | Findings→actions flat list, `candidateId = findingId::actionCode`, eligibility (severity !== "info"), trace events sorted candidateId ASC |
| **applyPatch** | `applyPatch.ts` (7KB) | Immutable JSON patch engine: set/increment/decrement, dot-path/bracket notation, 10+ veakoodiga `PatchError` |
| **actionImpact** | `computeActionImpact.ts` | `withActionImpacts()` simuleerib iga action'i riskScoreDelta, `_computingImpacts` guard |
| **evaluateRisk** | `evaluateRisk.ts` | Riskiskoor: error/warning/info kaalud, band A/B/C, top 2 contributors |
| **registry** | `registry.ts` | Konstantid: finding codes (RF_NEG, RESERVE_LOW jne), action codes, preset codes |
| **tüübid** | `solvereCoreV1.ts` (5KB) | ActionV1, FindingV1, EvaluationV1, ActionCandidateV1, RunReportV1, PolicyBundleV1, DeterminismDepsV1 |

### Majanduskava moodul (solvere-modules/majanduskava/)

| Komponent | Fail | Kirjeldus |
|-----------|------|-----------|
| **runtime** | `runtime.ts` | `createMajanduskavaRuntime()`: compute→evaluate→resolveActions→applyAction pipeline, setPolicyBundle/setDeterminismDeps laiendused |
| **evaluatePolicy** | `evaluatePolicy.ts` (5.6KB) | Finding'ute genereerimine: RF_NEG (remondifond negatiivne), RES_NEG (reserv negatiivne), RESERVE_LOW (reserv alla miinimumi), trace events |
| **compileRemedies** | `compileRemedies.ts` (3KB) | Remedy strategies: set_to, increase_by, decrease_by, increase_until; finding → ActionV1 kompileerimine |
| **policyLoader** | `policyLoader.ts` | 3 preset'i (BALANCED/CONSERVATIVE/LOAN_FRIENDLY), hardcoded remedies (YAML defineeritud aga mitte parsitud) |
| **manifest** | `manifest.ts` | moduleId: "majanduskava", version: "0.1.0" |

### Solverge Bridge (src/solvereBridge/)

`majanduskavaHost.js` (318 rida) — Solvere Core Contract v1 (frozen):
- `runPlan()`, `applyActionAndRun()`, `setPreset()`, `applyOnly()`, `runAutoResolve()`
- 8 dev-only runtime guard'i (SOLVERE_DEV_GUARDS_ENABLED master switch):
  1. traceV1 invariant
  2. nondeterministic fields check
  3. policyVersion stability
  4. determinism stability (evaluation fingerprint cache)
  5. loopGuard stability
  6. actionChain completeness
  7. deepFreeze
  8. autoResolve contract

### Engine (src/engine/)

`computePlan.js` (~400 rida) — puhas finantsmootor:
- Annuiteetlaen: igakuine makse, põhiosa, intress, jääk
- Rahavoogude agregatsioon kulude/tulude ridadest
- Remondifondi ja reservi bilanss (avamine → laekumine → väljaminek → sulgemine)
- Investeeringute rahastusplaani katvus
- Riskimõõdikud: laenukoormus €/m², omanike vajadus €/m²

### UI (src/MajanduskavaApp.jsx, ~2460 rida)

Implementeeritud funktsioonid:
- 7-tabi sidebar navigatsioon (dot-indikaatoritega)
- Perioodi sisestus (PP/KK/AAAA dropdown'id, majandusaasta kiirvalik)
- KÜ andmed (nimi, registrikood, aadress)
- Korterite tabel (tähis, omanikud, pind m², osa, märkused)
- Kaasomandi eseme seisukord (ESEMED × SEISUKORD × PRIORITEEDID, eeldatav kulu, planeeritud tegevus)
- Seisukord → investeering link ("Loo investeering" nupp, scrollIntoView)
- Muud investeeringud (nimi, maksumus, rahastusplaan)
- Kulude kategooriasüsteem (kommunaalteenused ühikupõhiselt, haldusteenused 3 arvutusviisiga)
- Tulude kategooriad (Majandamiskulude ettemaks, Vahendustasu, Renditulu, Muu tulu)
- Fondid: remondifond (€/m²/kuu), reservkapital, laenud
- Laenu liigid dropdown (Remondilaen, Investeerimislaen, Kapitalirent, Laen omanikelt, Muu)
- Laenu algus: kvartal + aasta dropdown'id (migreeritud vanast KK.AAAA formaadist)
- Korterite maksete tabel
- Kontroll & kokkuvõte (vastavus, eksport/import, süsteemi info)
- Prindi kokkuvõte
- NumberInput (Eesti koma) ja EuroInput (täisarv, tuhandete eraldaja) komponendid
- JSON eksport/import dry-run valideerimisega
- autoResolve bridge'i kaudu
- TracePanel visualiseerimine

---

## 2. Mis on pooleli (uncommitted)

Failis `src/MajanduskavaApp.jsx` on 103 rida muudatusi (committimata):

| Muudatus | Kirjeldus |
|----------|-----------|
| **LAENU_LIIGID** konstant | 5 laenuliiki: Remondilaen, Investeerimislaen, Kapitalirent, Laen omanikelt, Muu |
| **repairFundSaldo** state | Uus väli remondifondi praeguse saldo sisestamiseks (EuroInput) |
| **Laenu startYM migratsiooni loogika** | Import: vana `algus` "KK.AAAA" ja `startYM` "AAAA-KK" → `algusKvartal` + `algusAasta` |
| **Laenu algus UI** | Kuu dropdown (01–12) → kvartal dropdown (I–IV) + aasta |
| **Laenu liigi dropdown** | Uus "Liik" väli iga laenu juures |
| **Perioodi aasta sünkroonimine** | `useEffect` mis uuendab tühjad tegevusAasta/aasta väljad seisukord/muudInvesteeringud massiivis |
| **Remondifondi saldo sisend** | Uus EuroInput "Remondifondi saldo €" fondide tab'is |
| **Reservkapitali tekst** | "KrtS §48 — reservkapital..." → "Seadusega nõutav reserv ettenägematute kulude katteks (1/12 aasta kuludest)" |
| **Euro kuvamine** | Kulude/tulude koondrea ja haldusteenuste summad: enam ei kuva "–" kui 0, vaid kuvab "0 €" |
| **Eksport/import** | `repairFundSaldo` kaasatud JSON bundle'isse ja taastatud importimisel |
| **Tühjendamine** | Tab 4 tühjendamine kustutab ka `repairFundSaldo` |

---

## 3. Testide seis

**33/33 testi — kõik läbivad (0 failed)**

| Testifail | Testide arv | Staatus | Aeg |
|-----------|-------------|---------|-----|
| `determinism.test.ts` | 1 | PASS | 8ms |
| `policyRuntime.test.js` | 12 | PASS | 78ms |
| `majanduskava.e2e.test.ts` | 5 | PASS | 71ms |
| `autoResolve.test.ts` | 15 | PASS | 287ms |

### autoResolve.test.ts testide katvus:

- seenKey canonicalization (patch key-order sõltumatus)
- rankVector-põhine selection (primary/secondary/tertiary)
- CandidateEligibilityReason (ELIGIBLE, FILTERED_BY_SEEN, NOT_APPLICABLE)
- stateSignature NO_PROGRESS tuvastamine
- RunReportV1 consistency (stepsTaken > 0 ja === 0)
- Preset'i mõju report'ile
- Idempotentsus (re-run → 0 sammu)
- Determinism (kaks identset jooksu → identne tulemus)
- schemaVersion contract (evaluation/v1, trace/v1, stepTrace/v1, runReport/v1)
- Golden-trace snapshot (inline GOLDEN objekt)
- JSON round-trip serializable

### majanduskava.e2e.test.ts testide katvus:

- RF_NEG → INCREASE_REPAIR_FUND_RATE_SMALL action
- RESERVE_LOW → SET_RESERVE_TO_REQUIRED (reads metric)
- Risk shape ja presets (BALANCED vs CONSERVATIVE skoorid)
- Action impact arvutused

### Testidega katmata alad:

- `applyPatch.ts` veakoodid (unit testid puuduvad)
- `canonicalizePatch()` eraldi testid
- UI komponentide testid (puuduvad täielikult)
- `computePlan.js` engine testid (puuduvad)
- Laenu migratsiooniloogika testid
- policyLoader preset remedy struktuur

---

## 4. Failide struktuur

```
packages/solvere-core/src/
  index.ts, solvereCoreV1.ts, moduleHost.ts, autoResolve.ts,
  buildActionCandidates.ts, computeActionImpact.ts, applyPatch.ts,
  evaluateRisk.ts, registry.ts

solvere-modules/majanduskava/src/
  index.ts, runtime.ts, evaluatePolicy.ts, compileRemedies.ts,
  policyLoader.ts, manifest.ts, types.ts

src/
  MajanduskavaApp.jsx, App.jsx, main.jsx
  engine/computePlan.js
  domain/planSchema.js
  solvereBridge/majanduskavaHost.js
  policy/majanduskava-policy.v1.yaml
  policy/trace/traceV1.ts
  policy/__tests__/{autoResolve,determinism,majanduskava.e2e,policyRuntime}.test.{ts,js}
  components/TracePanel.jsx
```
