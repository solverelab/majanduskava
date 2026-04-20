// src/domain/meetingMaterials.js
// Koosoleku materjali / päevakorra mustandi genereerimine plaani põhjal.
// Puhas funktsioon — ei muuda arvutusi ega state'i, vaid tuletab struktureeritud
// päevakorra ja materjalide loetelu olemasolevast plaanist.

const N = (v) => Number(v) || 0;

function buildPeriodLabel(plan) {
  const start = plan?.period?.start || "";
  const end = plan?.period?.end || "";
  if (start && end) return `${start}–${end}`;
  return plan?.period?.year ? String(plan.period.year) : "";
}

export function buildMeetingMaterials(plan, { approvalStatus = "unlocked" } = {}) {
  const periodLabel = buildPeriodLabel(plan);
  const agenda = [];
  const materials = ["Majanduskava eelnõu", "Korteriomanike maksete jaotuse ülevaade"];

  agenda.push(`Majanduskava kinnitamine${periodLabel ? ` (${periodLabel})` : ""}`);

  if (N(plan?.funds?.reserve?.plannedEUR) > 0) {
    agenda.push("Reservkapitali makse suuruse kinnitamine");
  }

  if (N(plan?.funds?.repairFund?.monthlyRateEurPerM2) > 0) {
    agenda.push("Remondifondi makse suuruse kinnitamine");
  }

  const investments = plan?.investments?.items || [];
  const conditionItems = plan?.assetCondition?.items || [];
  if (investments.length > 0 || conditionItems.length > 0) {
    agenda.push("Investeeringute / tööde plaani kinnitamine");
    if (investments.length > 0) materials.push("Investeeringute loetelu");
    if (conditionItems.length > 0) materials.push("Seisukorra / tööde ülevaade");
  }

  const loans = plan?.loans || [];
  const hasConditionalLoan = investments.some(
    (inv) => (inv.fundingPlan || []).some((fp) => fp.source === "Laen")
  );
  if (loans.length > 0 || hasConditionalLoan) {
    agenda.push("Laenuga seotud otsuse punkt");
    materials.push("Laenutingimuste kokkuvõte");
  }

  let approvalNote = null;
  if (approvalStatus === "match") approvalNote = "Koosoleku materjalide aluseks on kinnitatud eelnõu";
  else if (approvalStatus === "mismatch") approvalNote = "Hoiatus: kava on pärast eelnõu kinnitamist muudetud";

  return { agenda, materials, approvalNote };
}

export function formatMeetingMaterialsText(m) {
  const lines = [];
  if (m.approvalNote) {
    lines.push(m.approvalNote);
    lines.push("");
  }
  lines.push("PÄEVAKORD");
  m.agenda.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push("");
  lines.push("MATERJALID");
  m.materials.forEach((x) => lines.push(`• ${x}`));
  return lines.join("\n");
}

// Tähtaja "lähedus" nähtavuse tarbeks — kas deadline on tänasest alla 7 päeva.
// Puhas funktsioon, ei muuda arvutust ega state'i.
export function isWrittenVotingDeadlineSoon(deadline, now = new Date()) {
  if (!deadline) return false;
  const dl = new Date(deadline);
  if (Number.isNaN(dl.getTime())) return false;
  const MS = 24 * 60 * 60 * 1000;
  const dlDay = Date.UTC(dl.getUTCFullYear(), dl.getUTCMonth(), dl.getUTCDate());
  const nowD = now instanceof Date ? now : new Date(now);
  const nowDay = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate());
  const days = Math.round((dlDay - nowDay) / MS);
  return days < 7;
}

// Kirjaliku hääletamise paketi kopeeritav tekstiväljund.
// agendaItems ja materialItems tulevad sisendina (kanooniliselt meeting materials
// helperist või salvestatud paketist).
export function formatWrittenVotingPackageText({ periodLabel = "", agendaItems = [], materialItems = [], deadline = "" } = {}) {
  const lines = [];
  lines.push("KIRJALIKU HÄÄLETAMISE PAKETT");
  lines.push("");
  lines.push(
    `Otsuse eelnõu: korteriühistu üldkoosolek${periodLabel ? ` (${periodLabel})` : ""} otsustab ` +
    "majanduskava eelnõu ja sellega seotud päevakorrapunktide üle kirjalikult."
  );
  lines.push("");
  lines.push("PÄEVAKORD");
  agendaItems.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  lines.push("");
  lines.push("MATERJALID");
  materialItems.forEach((x) => lines.push(`• ${x}`));
  lines.push("");
  lines.push(`Tähtaeg: ${deadline || "—"}`);
  lines.push("");
  lines.push("Seisukoht tuleb esitada kirjalikku taasesitamist võimaldavas vormis.");
  return lines.join("\n");
}
