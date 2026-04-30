/**
 * normalizeCostAllocation(row)
 *
 * Reads a cost/loan row and returns a canonical allocation descriptor.
 * New-model fields take priority; legacy `allocationBasis` is the fallback.
 *
 * NOTE: rateDisplayMode is display-only. It must never reach computePlan.
 */

// ── Display helpers ──────────────────────────────────────────────────────────

export function displayCostAllocationBasis(basis) {
  if (basis === "korteri_kohta") return "Korteri kohta";
  if (basis === "muu") return "Muu";
  return "Kaasomandi osa suuruse alusel"; // kaasomandi_osa + safe fallback
}

export function displayLegalBasis(legalBasis) {
  if (legalBasis === "seadus") return "Seadus";
  if (legalBasis === "pohikiri") return "Põhikiri";
  if (legalBasis === "kokkulepe") return "Kokkulepe";
  if (legalBasis === "muu") return "Muu";
  return "Vajab täpsustamist"; // unknown + safe fallback
}

export function displayRateMode(rateDisplayMode) {
  if (rateDisplayMode === "eur_per_m2") return "Kuvatakse €/m² abinäitajana";
  if (rateDisplayMode === "eur_per_apartment") return "Kuvatakse €/korter abinäitajana";
  if (rateDisplayMode === "total_only") return "Kuvatakse kogusummana";
  return null; // "none" → don't render
}

function deriveLegacyLegalBasis(row) {
  const bylaws = !!row.legalBasisBylaws;
  const agreement = !!row.legalBasisSpecialAgreement;
  const other = !!row.legalBasisMuu;
  const count = [bylaws, agreement, other].filter(Boolean).length;
  if (count !== 1) return "unknown";
  if (bylaws) return "pohikiri";
  if (agreement) return "kokkulepe";
  return "muu";
}

export function normalizeCostAllocation(row) {
  const safe = row ?? {};

  const lbDetail = safe.legalBasisTaepsustus ?? null;
  const abDetail = safe.allocationBasisMuuKirjeldus ?? null;

  // ── 1. New model: costAllocationBasis present ────────────────────────────
  if (safe.costAllocationBasis != null) {
    return {
      costAllocationBasis: safe.costAllocationBasis,
      rateDisplayMode: safe.rateDisplayMode ?? "none",
      legalBasis: safe.legalBasis ?? "unknown",
      legalBasisDetail: safe.legalBasisDetail ?? null,
      allocationBasisDetail: safe.allocationBasisDetail ?? null,
      migrationSource: "new_model",
    };
  }

  // ── 2. Legacy fallback ───────────────────────────────────────────────────
  const legacy = safe.allocationBasis;

  // 2a. m2 (default when absent)
  if (!legacy || legacy === "m2") {
    const bylaws = !!safe.legalBasisBylaws;
    const agreement = !!safe.legalBasisSpecialAgreement;
    const other = !!safe.legalBasisMuu;
    const count = [bylaws, agreement, other].filter(Boolean).length;
    let legalBasis;
    if (count === 0) {
      legalBasis = "seadus";
    } else if (count === 1) {
      if (bylaws) legalBasis = "pohikiri";
      else if (agreement) legalBasis = "kokkulepe";
      else legalBasis = "muu";
    } else {
      legalBasis = "unknown";
    }
    return {
      costAllocationBasis: "kaasomandi_osa",
      rateDisplayMode: "eur_per_m2",
      legalBasis,
      legalBasisDetail: lbDetail,
      allocationBasisDetail: abDetail,
      migrationSource: "legacy_m2",
    };
  }

  // 2b. apartment / korter
  if (legacy === "apartment" || legacy === "korter") {
    // legalBasisSeadus true = inconsistency → unknown
    const legalBasis = safe.legalBasisSeadus
      ? "unknown"
      : deriveLegacyLegalBasis(safe);
    return {
      costAllocationBasis: "korteri_kohta",
      rateDisplayMode: "eur_per_apartment",
      legalBasis,
      legalBasisDetail: lbDetail,
      allocationBasisDetail: abDetail,
      migrationSource: "legacy_apartment",
    };
  }

  // 2c. muu / other
  if (legacy === "muu" || legacy === "other") {
    return {
      costAllocationBasis: "muu",
      rateDisplayMode: "total_only",
      legalBasis: deriveLegacyLegalBasis(safe),
      legalBasisDetail: lbDetail,
      allocationBasisDetail: abDetail,
      migrationSource: "legacy_muu",
    };
  }

  // 2d. Unknown legacy value
  return {
    costAllocationBasis: "muu",
    rateDisplayMode: "total_only",
    legalBasis: "unknown",
    legalBasisDetail: lbDetail,
    allocationBasisDetail: abDetail,
    migrationSource: "legacy_unknown",
  };
}
