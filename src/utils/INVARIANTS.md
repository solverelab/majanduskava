# Majanduskava plaani invariandid

Viimati uuendatud: 2026
Kasuta seda faili muudatuste kontrollnimekirjana enne iga olulise loogika muutmist.

---

## 1. Canonical state

**INV-01** `plan.investments.items` on ainuke kanoniline allikas kõigile investeeringutele — `assetCondition` read on lähteandmed, mitte paralleelne investeeringute register.

**INV-02** condition_item investeeringu `sourceRefId` viitab täpselt ühele `assetCondition.items` rea `id`-le; standalone investeeringul `sourceRefId` puudub või on `null`.

**INV-03** Kui `fundingPlan` sisaldab kirjet `source === "Laen"`, peab `plan.loans` sisaldama täpselt ühe vastava `sepiiriostudInvId`-ga kirje — mitte rohkem, mitte vähem.

**INV-04** `plan.loans` kirje ilma `sepiiriostudInvId`-ta on olemasolev laen; kirje koos `sepiiriostudInvId`-ga on planeeritud investeerimislaen.

---

## 2. Investment ↔ loan consistency

**INV-05** condition_item investeeringu `name`, `totalCostEUR` ja `plannedYear` tuletatakse deterministlikult oma lähteseisukorra reast — neid välju ei muudeta otse, ainult läbi `uuendaSeisukord`.

**INV-06** Laenu kustutamisel eemaldatakse atomaarselt nii `plan.loans` kirje kui ka seotud investeeringu `fundingPlan` rida — need kaks operatsiooni ei tohi toimuda eraldi.

**INV-07** `fundingPlan` kirjete summa ei tohi ületada investeeringu `totalCostEUR` väärtust — ülejääk kärbitakse arvutuses `Math.min`-iga, see ei põhjusta viga.

---

## 3. Derived state / sync

**INV-08** Remondifondi kogumismäär tuleneb investeeringute mudelist (`computeRemondifondiArvutus`), mitte tegevuskuludest. `computePlan` ainult rakendab seda määra perioodituluks (`monthlyRateEurPerM2 × area × monthEq`). `plan.funds.repairFund.monthlyRateEurPerM2` on tuletatud väli — selle ainuke allikas on `remondifondiArvutus.maarAastasM2 / 12`; väärtust ei muudeta käsitsi.

**INV-09** Reservkapitali miinimum tuleneb tegevuskuludest (`computeReserveMin(costRows, monthEq)`), mitte investeeringutest. `plan.funds.reserve.plannedEUR` on auto-täidetud `reserveMin.noutavMiinimum`-iga kuni hetkeni, mil kasutaja muudab väärtust käsitsi (`resKapManual === true`); pärast seda auto-täitmine peatub.

**INV-10** Kõik periood→kuu teisendused kasutavad sama `mEq = derived.period.monthEq || 12` väärtust — kohalikud `/ 12` hardcoded teisendused on viga.

---

## 4. View consistency

**INV-11** APPLIED staatusega planeeritud laen (`sepiiriostudInvId` on seatud, `loanStatus === "APPLIED"`) ei sisaldu kohustuslikes maksetes üheski vaates — ei `kopiiriondvaade.laenumaksedKokku`-s, ei korterimaksetes ega print-kokkuvõttes.

**INV-12** APPROVED staatusega laen (`loanStatus === "APPROVED"`) sisaldub identselt kõigis neljas vaates: `kopiiriondvaade`, `korteriteKuumaksed`, Kokkuvõte tab ja print-vaade.

**INV-13** "Kulud kokku kuus" peab olema arvväärtusena identne kõigis neljas vaates sama `plan` state'i korral — erinevad kuvamisformaadid on lubatud, erinev arvväärtus mitte.

---

## 5. Input safety

**INV-14** Arvutused ei loe `summaInput`, `principalEUR`, `areaM2` ega `totalCostEUR` väärtust otse — need läbivad alati `parseFloat(x) || 0` ja `Math.max(0, ...)` filtri enne kasutamist.

**INV-15** `mEq` (perioodi kuuekvivalent) on alati `>= 1` — jagatavana kasutamise eel kaitstud `Math.max(1, ...)` või `|| 1`-iga, et vältida nulliga jagamist.
