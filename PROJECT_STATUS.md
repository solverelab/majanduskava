# PROJECT_STATUS.md

Projekti seis: 2026-02-28

---

## 1. Mis on tehtud

### Solvere Core framework (packages/solvere-core/)

| Komponent | Fail | Kirjeldus |
|-----------|------|-----------|
| **moduleHost** | `moduleHost.ts` (477 rida) | Orkestraator: `createModuleHost()`, `buildStateSignature()` (FNV-1a hash), `buildPolicyVersion()`, `buildEvaluationSnapshot()`, deterministlikkuse kontrollid, contract assertions |
| **autoResolve** | `autoResolve.ts` (558 rida) | Loop: `pickFromCandidates()` rankVector-ranking (riskScoreDelta ASC → actionCode ASC → candidateId ASC), seenKey loop guard (`candidateId::canonicalPatch`), max 10 sammu, 5 stop-reason'it (NO_ACTIONS, NO_CHOICE, LOOP_GUARD, NO_PROGRESS, MAX_STEPS), RunReportV1 genereerimine |
| **actionCandidates** | `buildActionCandidates.ts` (67 rida) | Findings→actions flat list, `candidateId = findingId::actionCode`, eligibility (severity !== "info"), trace events sorted candidateId ASC |
| **applyPatch** | `applyPatch.ts` (156 rida) | Immutable JSON patch engine: set/increment/decrement, dot-path + bracket notation, `parsePath()` tokenizer, 10+ veakoodiga `PatchError` |
| **actionImpact** | `computeActionImpact.ts` (41 rida) | `withActionImpacts()` simuleerib iga action'i mõju: `afterRiskScore - baseRiskScore` → `action.impact.riskScoreDelta` |
| **evaluateRisk** | `evaluateRisk.ts` (57 rida) | Riskiskoor 0–100: error/warning/info kaalud preset'i järgi, band A/B/C, top 2 contributors |
| **registry** | `registry.ts` | 19 finding code'i (RF_NEG, RES_NEG, RESERVE_LOW, APT_MIN, AREA_ZERO jne), 5 action code'i, 3 preset code'i |
| **tüübid** | `solvereCoreV1.ts` | ActionV1, FindingV1, EvaluationV1, ActionCandidateV1, RunReportV1, PolicyBundleV1, DeterminismDepsV1, PatchOperation |

### Majanduskava moodul (solvere-modules/majanduskava/)

| Komponent | Fail | Kirjeldus |
|-----------|------|-----------|
| **runtime** | `runtime.ts` (43 rida) | `createMajanduskavaRuntime()`: compute→evaluate→resolveActions→applyAction pipeline, setPolicyBundle/setDeterminismDeps |
| **evaluatePolicy** | `evaluatePolicy.ts` (143 rida) | Finding'ute genereerimine: RF_NEG, RES_NEG, RESERVE_LOW + controls.issues mappimine, kohandatud riskiskoor (deficit-põhine) |
| **compileRemedies** | `compileRemedies.ts` (79 rida) | 4 remedy strateegiat: set_to, increase_by, decrease_by, increase_until; finding → ActionV1 kompileerimine |
| **policyLoader** | `policyLoader.ts` (65 rida) | 3 preset'i (BALANCED/CONSERVATIVE/LOAN_FRIENDLY), hardcoded remedies: RF_NEG → +0.05/+0.10 €/m², RES_NEG → +250/+500 €, RESERVE_LOW → set_to_required |
| **manifest** | `manifest.ts` | moduleId: "majanduskava", version: "0.1.0", 3 preset'i |

### Solvere Bridge (src/solvereBridge/)

`majanduskavaHost.js` (318 rida) — Solvere Core Contract v1:
- `runPlan()`, `applyActionAndRun()`, `setPreset()`, `applyOnly()`, `runAutoResolve()`
- 8 dev-only runtime guard'i (SOLVERE_DEV_GUARDS_ENABLED):
  1. traceV1 invariant (schemaVersion, events array)
  2. nondeterministic fields check (timestamp, random)
  3. policyVersion stability
  4. determinism stability (evaluation fingerprint cache, 200 max)
  5. loopGuard stability
  6. actionChain completeness
  7. deepFreeze (dev-mode immutability)
  8. autoResolve contract assertions

### Engine (src/engine/)

`computePlan.js` (~500 rida) — puhas finantsmootor:
- Annuiteetlaen: igakuine makse, põhiosa, intress, jääk (`arvutaKuumakse()`)
- Perioodi arvutus: `daysBetween()`, `monthEquiv()`, `yearFraction()`
- Rahavoogude agregatsioon: 4 calc-tüüpi (FIXED_PERIOD, MONTHLY_FIXED, ANNUAL_FIXED, QTY_PRICE_ANNUAL)
- Remondifondi ja reservi bilanss (avamine → laekumine → väljaminek → sulgemine)
- Investeeringute rahastusplaani katvus ja valdkondade väljavoolud
- Riskimõõdikud: laenukoormus €/m², omanike vajadus €/m²
- Controls/issues: 19 validatsioonireeglit (APT_MIN, AREA_ZERO, RF_NEG, NET_SURPLUS jne)
- `euro()` formaat (tuhandete eraldaja), `round2()`

### Poliitika definitsioon (src/policy/)

`majanduskava-policy.v1.yaml` (153 rida):
- 3 preset'i: BALANCED (tasakaalustatud), CONSERVATIVE (konservatiivne), LOAN_FRIENDLY (laenusõbralik)
- Hard rules: requireNonNegativeRepairFund, requireReserveAtLeastRequired
- Limits per preset: loanWarnPerM2, loanErrorPerM2, ownersWarnPerM2, ownersErrorPerM2
- Scoring weights: loan vs owners kaalud, band piirid
- Remedy definitsioonid: ADJUST_REPAIR_FUND_RATE, ONE_OFF_PAYMENT

### Domeeniskeem (src/domain/)

`planSchema.js` (76 rida):
- `mkApartment()`, `mkCashflowRow()`, `mkInvestmentItem()`, `mkLoan()`
- `defaultPlan({ year })` → täielik plan skeleton (period, building, budget, funds, loans, openingBalances)

### EHR API integratsioon (src/services/ + src/components/)

`ehrService.js` (112 rida) — In-ADS + EHR API liides:
- `searchAddress(query)` — In-ADS gazetteer aadressi otsing, filtreerib hooned (liik=E), timeout 8s
- `fetchBuildingCode(adsOid)` — fallback EHR koodi päring ADS OID järgi
- `fetchApartments(ehrCode)` — EHR buildingData v2, korterite m² (ehitiseOsaPohiandmed.pind), loomulik sortimine
- API-d testitud reaalsete andmetega (nt Tartu mnt 18, Tallinn → 29 korterit, 1716 m²)

`AddressSearch.jsx` (~227 rida) — Aadressi autocomplete komponent:
- Debounce 300ms, min 3 tähemärki, dropdown kuni 10 tulemust
- Klaviatuurinavigatsioon: ↑↓ nooled, PgUp/PgDn (5 rida), Enter valik, Esc sulgemine
- Hiire hover ja keyboard highlight sünkroonis, scrollIntoView
- Click-outside sulgemine (useRef + useEffect)
- Aadressi valikul laadib automaatselt korterite m² andmed EHR-ist
- KÜ nime automaatne uuendamine (kui tühi või algab "KÜ ")
- Laadimisindikaator ("Laadin korterite andmeid...") ja veateade
- Inline styles N paletiga (sama muster nagu TracePanel.jsx)

### UI (src/MajanduskavaApp.jsx, ~2950 rida)

#### DateInput komponent (inline)

- PP.KK.AAAA tekstisisend → ISO (YYYY-MM-DD) formaat
- Automaatne punkti-eraldaja: numbrite sisestamisel lisab automaatselt punktid (15062027 → 15.06.2027)
- inputMode="numeric" mobiilile numpad'i kuvamiseks
- select-all fookuse saamisel mugavaks ülekirjutamiseks
- onBlur valideerimine ja fallback eelmisele väärtusele

#### Olemasolevate laenude arvutusfunktsioonid (inline)

- `kuudeVahe(algusISO, loppISO)` — kuude arv kahe ISO kuupäeva vahel
- `arvutaOlemasolevLaen(laen, periodiAlgusISO)` — koondarvutusfunktsioon:
  - Annuiteet: iteratiivne jäägiarvestus (`jaak = jaak * (1+r) - makse`)
  - Võrdse põhiosaga: perioodi keskmine kuumakse
  - Tagastab `{ kuumakse, jaak, piisavAndmeid, arvutuskaik[] }`
  - `arvutuskaik[]` — loetavad arvutussammud kasutajale kuvamiseks
- `olLaenArvutused` useMemo — kõigi laenude arvutuste cache

#### 7 tabi:

| Tab | Nimetus | Sisu |
|-----|---------|------|
| 0 | Periood & korterid | KÜ andmed (nimi, registrikood, **aadress autocomplete + EHR**), perioodi DateInput (PP.KK.AAAA), majandusaasta kiirvalik, korterite tabel (Nr, m²) koos kokkuvõttega |
| 1 | Esemed ja investeeringud | Kaasomandi esemed (seisukord, prioriteet, eeldatav kulu, tegevus), seisukord→investeering link, muud investeeringud (nimi, maksumus), rahastusplaan (allikas + summa) |
| 2 | Kulud | Kategooriasüsteem (kommunaalteenused ühikupõhiselt, haldusteenused 3 arvutusviisiga), 4 calc-tüüpi, koondread |
| 3 | Tulud | Kategooriad (Halduskulude ettemaks, Renditulu, Muu tulu), koondread |
| 4 | Fondid & laen | Remondifond (saldo + määr, arvutuslik kokkuvõte tabel), olemasolevad laenud (DateInput kuupäevad, makseviisi valik, automaatne arvutus + arvutuskäik), planeeritud laenud (liigid, kvartal+aasta algus) |
| 5 | Korterite maksed | Kuumaksete lahtikirjutus per korter (kommunaal, haldus, remondifond, laenumakse), laiendatavad detailread valemitega |
| 6 | Kontroll & kokkuvõte | Solvere findings + risk badge, "Lahenda kõik" nupp, JSON eksport/import, printimise kokkuvõte, tehniline info (TracePanel) |

#### Olulised UI-funktsioonid:

- **Aadressi autocomplete** — AddressSearch komponent Tab 0-s, In-ADS → EHR ahel laadib korterite m² andmed automaatselt, klaviatuurinavigatsioon
- **Korterite tabel** — lihtsustatud: ainult Nr ja m² veerud + kustuta nupp, kokkuvõtterida "Kortereid: N | Kogupind: X m²"
- **Koondvaade riba** — kõigil tabilehekülgedel, näitab: Kulud | Tulud | Laenumaksed | Vahe (roheline/hall/punane)
- **Koondvaade kaardid** (Tab 6) — eraldi halduskulud ja kommunaalkulud (läbivool, opacity 0.7), tulud, laenumaksed, vahe (haldus) + aastane kokkuvõte
- **Automaatne laenurida rahastusplaanist** — "Laen" allika valimisel investeeringu rahastusplaanis tekib automaatselt laenurida Fondid & laen tabi
- **Olemasolevad laenud** — eraldi `olemasolevaLaenud` state, DateInput kuupäevad, makseviisi valik (annuiteet/võrdse põhiosaga), automaatne kuumakse ja jäägi arvutus, arvutuskäik read-only kastis
- **Remondifondi arvutus** — saldo alguses + laekumine − investeeringud = saldo lõpus, negatiivse saldo hoiatus
- **Korterite kuumaksed** — per korter kommunaal/haldus/remondifond/laenumakse jaotus, laiendatavad valemid
- **DateInput** — PP.KK.AAAA formaat automaatse punkti-eraldajaga, select-all fookuses
- **NumberInput** (Eesti koma) ja **EuroInput** (täisarv, tuhandete eraldaja)
- **JSON eksport/import** dry-run valideerimisega, migratsioonidega (sh "Majandamiskulude ettemaks" → "Halduskulude ettemaks", "Vahendustasu" → "Muu tulu")
- **Prindi kokkuvõte** — täislehekülje layout (lihtsustatud korterite tabel Nr + m²)

#### Tulukategooriate terminoloogia:

- "Majandamiskulude ettemaks" → **"Halduskulude ettemaks"** (selgem terminoloogia)
- "Vahendustasu" **eemaldatud** eraldi kategooriana (seadusega piiratud, vajadusel kasutab "Muu tulu")
- JSON import migratsioon tagab tagasiühilduvuse vanade failidega

---

## 2. Mis on pooleli

Hetkel ei ole pooleliolevaid muudatusi — kõik committitud.

### Tegemata / tulevikus:

| Valdkond | Kirjeldus | Prioriteet |
|----------|-----------|------------|
| **YAML poliitika parsimine** | `policyLoader.ts` kasutab hardcoded remedies, YAML fail defineerib need aga parsimist ei toimu | Keskmine |
| **CONSERVATIVE/LOAN_FRIENDLY eristus** | Praegu on 3 preset'i remedied identsed; YAML-is defineeritud limits/scoring erinevused ei rakendu | Keskmine |
| **SHIFT_INVESTMENT action** | `policyRuntime.js` rida 115-122: confidence "LOW", `patch: []` (tühi), vajab käsitsi investeeringu valikut | Madal |
| **EXTEND_LOAN_TERM action** | Heuristiline arvutus (lineaarne koormuse vähendamine), mitte täpne annuiteet-ümberarvutus | Madal |
| **computePlan.js testid** | Engine'il puuduvad unit testid (annuiteet, rahavood, fondid) | Keskmine |
| **applyPatch unit testid** | Puuduvad eraldi testid veakoodidele (KEY_NOT_FOUND, INDEX_OOB jne) | Madal |
| **UI testid** | Puuduvad täielikult — pole React Testing Library ega Playwright teste | Madal |
| **Laenu graafik UI-s** | computePlan arvutab laenugraafiku, aga UI ei kuva detailselt igakuiseid makseid | Madal |
| **Undo/redo** | Immutable state võimaldaks, aga pole implementeeritud | Madal |
| **Validatsioonihoiatused inline** | computePlan genereerib controls.issues, aga neid näidatakse ainult Solvere findings'ina, mitte vormivigadena | Madal |

---

## 3. Testide seis

**33/33 testi — kõik läbivad (0 failed)**

```
vitest v4.0.18
 ✓ src/policy/__tests__/determinism.test.ts        (1 test)    8ms
 ✓ src/policy/__tests__/policyRuntime.test.js       (12 tests)  39ms
 ✓ src/policy/__tests__/majanduskava.e2e.test.ts    (5 tests)   44ms
 ✓ src/policy/__tests__/autoResolve.test.ts         (15 tests)  168ms

 Test Files  4 passed (4)
      Tests  33 passed (33)
   Duration  1.15s
```

### Testide katvus detailne:

#### autoResolve.test.ts (15 testi)

- seenKey canonicalization (patch key-order sõltumatus)
- rankVector-põhine selection (primary: riskScoreDelta, secondary: actionCode, tertiary: candidateId)
- CandidateEligibilityReason (ELIGIBLE, FILTERED_BY_SEEN, NOT_APPLICABLE)
- stateSignature NO_PROGRESS tuvastamine
- RunReportV1 consistency (stepsTaken > 0 ja === 0)
- Preset'i mõju report'ile
- Idempotentsus (re-run → 0 sammu)
- Determinism (kaks identset jooksu → identne tulemus)
- schemaVersion contract (evaluation/v1, trace/v1, stepTrace/v1, runReport/v1)
- Golden-trace snapshot (inline GOLDEN objekt)
- JSON round-trip serializable

#### policyRuntime.test.js (12 testi)

- Policy YAML laadimine ja parseerimine
- Finding'ute genereerimine: RF_NEG, RES_NEG, RESERVE_LOW
- LOAN_WARN, LOAN_ERROR künnised
- OWNERS_WARN, OWNERS_ERROR künnised
- Riskiskoori arvutamine (score, level, band)
- Preset'ide laadimine (BALANCED, CONSERVATIVE, LOAN_FRIENDLY)
- `applyPatch()` operatsioonid (set, increment, array indices)

#### majanduskava.e2e.test.ts (5 testi)

- RF_NEG finding → INCREASE_REPAIR_FUND_RATE_SMALL action (+0.05 patch)
- RESERVE_LOW → SET_RESERVE_TO_REQUIRED (loeb metrics.funds.reserveRequiredEUR)
- Risk shape ja presets (BALANCED vs CONSERVATIVE riskiskoorid)
- Action impact arvutused (riskScoreDelta)
- Täielik pipeline: plan → host.run → applyActionAndRun → uus evaluation

#### determinism.test.ts (1 test)

- Sama sisend → identne väljund (ei sisalda timestamp'e, random väärtusi)

### Testidega katmata:

- `applyPatch.ts` veakoodid (unit testid puuduvad)
- `canonicalizePatch()` eraldi testid
- `computePlan.js` engine arvutused (annuiteet, periood, fondid)
- `evaluateRisk.ts` kaalud ja band'id
- `ehrService.js` API funktsioonid (mocked testid puuduvad)
- `AddressSearch.jsx` komponendi testid
- UI komponentide testid üldiselt
- JSON eksport/import migratsioonid

---

## 4. Failide struktuur

```
packages/solvere-core/src/
  index.ts                    — Public API eksport (~30 tüüpi ja funktsiooni)
  solvereCoreV1.ts            — Tüübidefinitsioonid (Action, Finding, Evaluation, Risk jne)
  moduleHost.ts               — Orkestraator, state signature, contract assertions
  autoResolve.ts              — Automaatne lahendusloop, candidate selection, loop guard
  buildActionCandidates.ts    — Findings→candidates flat list
  computeActionImpact.ts      — Action simulatsioon, riskScoreDelta
  applyPatch.ts               — Immutable JSON patch engine (set/increment/decrement)
  evaluateRisk.ts             — Riskiskoor 0–100, band A/B/C
  registry.ts                 — Finding codes, action codes, preset codes

solvere-modules/majanduskava/src/
  index.ts                    — Module eksport
  manifest.ts                 — Module ID, versioon, skeemid
  types.ts                    — PlanState, PlanMetrics tüübid
  runtime.ts                  — Runtime factory (compute→evaluate→resolve→apply)
  evaluatePolicy.ts           — Finding'ute genereerimine (RF_NEG, RES_NEG, RESERVE_LOW)
  compileRemedies.ts          — Remedy→Action kompileerimine (4 strateegiat)
  policyLoader.ts             — 3 preset'i hardcoded remedies'ega

src/
  MajanduskavaApp.jsx         — Monoliitne React UI (~2950 rida, 7 tabi)
  App.jsx                     — Root wrapper
  main.jsx                    — Entry point
  engine/computePlan.js       — Puhas finantsmootor (~500 rida)
  domain/planSchema.js        — Domeenimudelite factory'd (76 rida)
  solvereBridge/majanduskavaHost.js — Solvere Core ↔ React bridge (318 rida)
  policy/majanduskava-policy.v1.yaml — Poliitika definitsioon (153 rida)
  policy/policyRuntime.js     — Legacy poliitikamootor (296 rida)
  policy/__tests__/           — 4 testifaili, 33 testi
  services/ehrService.js      — In-ADS + EHR API liides (112 rida)
  components/TracePanel.jsx   — Solvere trace visualiseerimine
  components/AddressSearch.jsx — Aadressi autocomplete + EHR korterite laadimine (~227 rida)
```

---

## 5. Commit'ide ajalugu (viimased)

```
88a5fee remove: Vahendustasu tulukategooriast (seadusega piiratud, kasutab Muu tulu)
ca9f12c refactor: Majandamiskulude ettemaks → Halduskulude ettemaks (selgem terminoloogia)
9542b3b feat: koondvaade kaardid eraldavad haldus vs kommunaal
9afa5ee fix: DateInput selects all on focus for clean overwrite
643a76c feat: DateInput auto-dot mask (PP.KK.AAAA)
3b7cdb9 feat: keyboard navigation for address autocomplete (↑↓ PgUp PgDn Enter Esc)
78b2f32 fix: KÜ nimi uueneb uue aadressi valikul (kui automaatne)
13d59c4 refactor: period dates use DateInput (DD.MM.YYYY)
b487cf4 feat: DateInput component (DD.MM.YYYY text input → ISO)
19e0c35 fix: eemalda segane "Omanike kuuvajadus" rida Tab 5-st
eca6044 feat: olemasolevad laenud — automaatne arvutus UI + arvutuskäik
ac98266 feat: näita arvutuslik kuumakse ja jääk olemasoleva laenu real
a6df107 feat: olemasolevate laenude automaatne arvutus (annuiteet + võrdne põhiosa)
8b012d2 refactor: arvutaOlemasolevLaen koondarvutusfunktsioon
8f540ad feat: olemasolevate laenude automaatsed arvutusfunktsioonid
1e3cc4c refactor: perioodi kuupäevad — date picker, eemalda periodParts state
498f25d refactor: olemasolevad laenud — date picker + makseviis dropdown
aaaaf1e feat: remondifondi arvutus, korterite kuumaksete lahtikirjutus, laenu algusAasta sync
289764a fix: olemasolevaLaenud useState deklaratsioon enne useMemo kasutust
757a502 feat: olemasolevad laenud sektsioon, laenude peitmine, koondvaade + aastane kokkuvõte
e449942 feat: automaatne laenurida rahastusplaanist, koondvaade kõigil tabilehekülgedel
dd6fc46 feat: laenuliigid, remondifondi saldo, perioodi aasta sync, PROJECT_STATUS uuendus
```
