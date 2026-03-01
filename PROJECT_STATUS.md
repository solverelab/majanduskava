# PROJECT_STATUS.md

Projekti seis: 2026-03-01

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

### UI (src/MajanduskavaApp.jsx, ~3000 rida)

#### Input-komponendid (inline):

- **NumberInput** — Eesti komaga numbriline sisend, näitab tühja välja kui 0, väärtus commitakse blur-il
- **EuroInput** — täisarv tuhandete eraldajaga (`1 234`), blur-il commit
- **DateInput** — PP.KK.AAAA tekstisisend → ISO (YYYY-MM-DD), automaatne punkti-eraldaja, select-all fookuses
- Kõigil kolmel: **Enter-klahv** kutsub `blur()` → commitab väärtuse

#### Kategooriasüsteem:

```js
KOMMUNAALTEENUSED = ["Soojus", "Vesi ja kanalisatsioon", "Elekter", "Kütus", "Muu kommunaalteenus"]
HALDUSTEENUSED    = ["Haldus", "Raamatupidamine", "Koristus", "Kindlustus", "Hooldus", "Prügivedu", "Muu haldusteenus"]
LAENUMAKSED       = ["Laenumakse"]
```

- Tab 2 kulude dropdown: 3 optgroup'i (Kommunaalteenused, Haldusteenused, Laenumaksed)
- Tab 3 tulud: fikseeritud struktuur, dropdown puudub — Haldustasu ja Laenumakse readonly, Muu tulu muudetav

#### 7 tabi:

| Tab | Nimetus | Sisu |
|-----|---------|------|
| 0 | Periood & korterid | KÜ andmed (nimi, registrikood, **aadress autocomplete + EHR**), perioodi DateInput (PP.KK.AAAA), majandusaasta kiirvalik, korterite tabel (Nr, m²) koos kokkuvõttega |
| 1 | Esemed ja investeeringud | Kaasomandi esemed (seisukord, prioriteet, eeldatav kulu, tegevus), seisukord→investeering link (bidirectional sync eeldatavKulu ↔ invMaksumus), muud investeeringud (nimetus, maksumus — readonly), rahastusplaan (Remondifond/Laen/Toetus/Sihtmakse + summa) |
| 2 | Kulud | 3 visuaalset gruppi (Kommunaalteenused, Haldusteenused, Laenumaksed), `+ Lisa rida` nupp, kokkuvõte (kommunaal/haldus/laenu/kokku) |
| 3 | Tulud | Haldustasu (readonly, arvutatud kuludest), Laenumakse (readonly, kui > 0), Muu tulu read (muudetav nimetus + summa), `+ Lisa tulu` nupp, kokkuvõte (Haldustasu €/m², Laenumakse €/m², Muu tulu, Tulud kokku) |
| 4 | Fondid & laen | Remondifond (saldo + määr €/m² aastas, arvutuskäik), reservkapitali card, planeeritud laenud, koondribana (Haldusteenused &#124; Kommunaalteenused &#124; Kokku) |
| 5 | Korterite maksed | Kuumaksete lahtikirjutus per korter (kommunaal, haldus, remondifond, laenumakse), laiendatavad detailread valemitega |
| 6 | Kontroll & kokkuvõte | Solvere findings + risk badge, "Lahenda kõik" nupp, JSON eksport/import, printimise kokkuvõte, tehniline info (TracePanel) |

#### Olulised UI-funktsioonid:

- **Aadressi autocomplete** — AddressSearch komponent Tab 0-s, In-ADS → EHR ahel laadib korterite m² andmed automaatselt
- **Korterite tabel** — ainult Nr ja m² veerud + kustuta nupp, kokkuvõtterida "Kortereid: N | Kogupind: X m²"
- **Koondribana** — ainult Tab 4-l nähtav, 1 rida: Haldusteenused | Kommunaalteenused | Kokku (arvutatud otse sisenditest)
- **Remondifond** — saldo alguses + laekumine (määr €/m² aastas) − investeeringud = saldo lõpus, inline inputs
- **Reservkapital** — nõutav miinimum = (haldus + kommunaal) aastas / 12 (likviidsuspuhver)
- **Automaatne laenurida** — "Laen" allika valimisel investeeringu rahastusplaanis tekib automaatselt laenurida
- **Korterite kuumaksed** — per korter kommunaal/haldus/remondifond/laenumakse jaotus
- **JSON eksport/import** — dry-run valideerimine, migratsioonid tagasiühilduvuseks

#### Migratsioonid:

**costRows import:**
- `"Muu"` → `"Muu haldusteenus"`
- `remondifond.maarKuusM2` → `maarAastasM2` (× 12)
- Rahastusplaan: `"Erakorraline makse"` → `"Sihtmakse"`, `"Reservkapital"` → `"Remondifond"`

**incomeRows useEffect:**
- `"Halduskulude ettemaks"`, `"Majandamiskulude ettemaks"`, `"Vahendustasu"` → eemaldatakse (return null)
- `"Renditulu"` → `"Muu tulu"` + nimetus "Renditulu"
- Muud tundmatud kategooriad → `"Muu tulu"`
- `.filter(Boolean)` puhastab

---

## 2. Mis on pooleli

Hetkel ei ole pooleliolevaid muudatusi — kõik committitud ja deployitud.

### Tegemata / tulevikus:

| Valdkond | Kirjeldus | Prioriteet |
|----------|-----------|------------|
| **YAML poliitika parsimine** | `policyLoader.ts` kasutab hardcoded remedies, YAML fail defineerib need aga parsimist ei toimu | Keskmine |
| **CONSERVATIVE/LOAN_FRIENDLY eristus** | Praegu on 3 preset'i remedied identsed; YAML-is defineeritud limits/scoring erinevused ei rakendu | Keskmine |
| **SHIFT_INVESTMENT action** | `policyRuntime.js`: confidence "LOW", `patch: []` (tühi), vajab käsitsi investeeringu valikut | Madal |
| **EXTEND_LOAN_TERM action** | Heuristiline arvutus (lineaarne koormuse vähendamine), mitte täpne annuiteet-ümberarvutus | Madal |
| **computePlan.js testid** | Engine'il puuduvad unit testid (annuiteet, rahavood, fondid) | Keskmine |
| **UI testid** | Puuduvad täielikult — pole React Testing Library ega Playwright teste | Madal |
| **Panga laenunõuete valideerimine** | Informatiivne valideerija remondifondi miinimumi kontrolliks | Madal |

---

## 3. Testide seis

**33/33 testi — kõik läbivad (0 failed)**

```
vitest v4.0.18
 ✓ src/policy/__tests__/determinism.test.ts        (1 test)
 ✓ src/policy/__tests__/policyRuntime.test.js       (12 tests)
 ✓ src/policy/__tests__/majanduskava.e2e.test.ts    (5 tests)
 ✓ src/policy/__tests__/autoResolve.test.ts         (15 tests)

 Test Files  4 passed (4)
      Tests  33 passed (33)
```

---

## 4. Failide struktuur

```
packages/solvere-core/src/
  index.ts                    — Public API eksport
  solvereCoreV1.ts            — Tüübidefinitsioonid
  moduleHost.ts               — Orkestraator, state signature, contract assertions
  autoResolve.ts              — Automaatne lahendusloop, candidate selection
  buildActionCandidates.ts    — Findings→candidates flat list
  computeActionImpact.ts      — Action simulatsioon, riskScoreDelta
  applyPatch.ts               — Immutable JSON patch engine
  evaluateRisk.ts             — Riskiskoor 0–100, band A/B/C
  registry.ts                 — Finding codes, action codes, preset codes

solvere-modules/majanduskava/src/
  index.ts                    — Module eksport
  manifest.ts                 — Module ID, versioon, skeemid
  types.ts                    — PlanState, PlanMetrics tüübid
  runtime.ts                  — Runtime factory
  evaluatePolicy.ts           — Finding'ute genereerimine
  compileRemedies.ts          — Remedy→Action kompileerimine
  policyLoader.ts             — 3 preset'i hardcoded remedies'ega

src/
  MajanduskavaApp.jsx         — Monoliitne React UI (~3000 rida, 7 tabi)
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
  components/AddressSearch.jsx — Aadressi autocomplete + EHR (~227 rida)
```

---

## 5. Commit'ide ajalugu (viimased)

```
da09d9b Enter-klahv commitab väärtuse NumberInput/EuroInput/DateInput komponentides
854b36f migratsioon: vanad tulukategooriad → Muu tulu
1686bfd addRow INCOME: Muu tulu vaikimisi, tühi summa
6a10fd9 Tab 3: fikseeritud struktuur — Haldustasu, Laenumakse, Muu tulu
af230ec Tab 2: kokkuvõte pärast Lisa rida nuppu
5feaf3a nimed: Halduskulude ettemaks → Haldustasu, migratsioon
878ca90 Tab 3: tulude kokkuvõte Haldustasu + Laenumakse €/m²
7e5212c Tab 3: Haldustasu ja Laenumakse readonly read
bbb9d0c Tab 2: kulude kokkuvõte kolme grupiga
207607f Tab 2: laenumaksed eraldi grupp
e9c78d7 kategooriad: Laenumakse eraldi grupp, Halduskulude ettemaks eemaldatud
5c7b344 Investeeringu nimetus/maksumus readonly + Ese → Nimetus
c67e274 remondifondi card: inline inputs, arvutuskäik, uus paigutus
5f61780 remondifond maarKuusM2→maarAastasM2
ed057ee fix koondribana: calculate directly from inputs
816d02b unify field labels to Maksumus €/periood, detailed cost summary
ea56653 kulude visuaalne grupeerimine: kommunaal / haldus
5cac01d rename Muu→Muu haldusteenus, add Muu kommunaalteenus
a2278e8 handoff v10: äriloogika #21-26, panga valideerimine tulevikku
```
