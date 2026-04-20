// src/domain/allocationBasisDisplay.js
// UI presentation helper for allocationPolicies — ei redigeeri poliitikat,
// ainult kajastab seda sildi ja õigusliku aluse märkena.
import { getEffectiveAllocationBasis } from "./planSchema";

const BASIS_LABELS = {
  m2: "m²",
  korter: "korteri kohta",
};

export function formatBasisLabel(basis) {
  return BASIS_LABELS[basis] || BASIS_LABELS.m2;
}

export function describeAllocationPolicy(policy) {
  const basis = getEffectiveAllocationBasis(policy);
  const hasOverride = !!(policy?.overrideBasis && policy?.legalBasis);
  return {
    basis,
    basisLabel: formatBasisLabel(basis),
    hasOverride,
    legalBasis: hasOverride ? policy.legalBasis : null,
    legalBasisNote: hasOverride ? (policy.legalBasisNote || "") : "",
  };
}

// Lühike üherealine kokkuvõte väljundi ja kokkuvõtte blokkide tarbeks.
export function summarizeAllocationPolicy(policy) {
  const d = describeAllocationPolicy(policy);
  const type = policy?.legalBasisType;
  if (type === "BYLAWS_EXCEPTION") {
    const meta = (policy?.legalBasisText && policy.legalBasisText.trim())
      || "Erand põhikirja järgi — alus täpsustamata";
    return `Jaotusalus: ${d.basisLabel} · ${meta}`;
  }
  if (type === "DEFAULT_KRTS40_1") {
    return `Jaotusalus: ${d.basisLabel} · Vaikimisi alus`;
  }
  // Backwards-compat: vana state ilma legalBasisType meta'ta
  if (d.hasOverride) {
    const note = d.legalBasisNote ? ` · Viide: ${d.legalBasisNote}` : "";
    return `Jaotusalus: ${d.basisLabel} · Õiguslik alus: ${d.legalBasis}${note}`;
  }
  return `Jaotusalus: ${d.basisLabel} · Vaikimisi alus`;
}
