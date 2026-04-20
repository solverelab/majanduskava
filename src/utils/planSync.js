/**
 * Syncs computed repair fund rate to plan state.
 * Returns the same plan reference if the value has not changed.
 */
export function syncRepairFundRate(plan, maarAastasM2) {
  const kuuMaar = maarAastasM2 / 12;
  if (plan.funds.repairFund.monthlyRateEurPerM2 === kuuMaar) return plan;

  return {
    ...plan,
    funds: {
      ...plan.funds,
      repairFund: {
        monthlyRateEurPerM2: kuuMaar,
      },
    },
  };
}

/**
 * Syncs repair fund opening balance from raw saldoAlgus string to plan state.
 * Returns the same plan reference if the value has not changed.
 */
export function syncRepairFundOpeningBalance(plan, saldoAlgusRaw) {
  const parsed = Math.round(parseFloat(String(saldoAlgusRaw).replace(",", ".")) || 0);
  if ((plan.openingBalances?.repairFundEUR || 0) === parsed) return plan;

  return {
    ...plan,
    openingBalances: {
      ...plan.openingBalances,
      repairFundEUR: parsed,
    },
  };
}

/**
 * Fills empty tegevusAasta and algusAasta fields with the given year.
 * Returns the same plan reference if nothing needs filling.
 */
export function fillMissingYearsFromPeriod(plan, year) {
  if (!year) return plan;
  const ys = String(year);

  const current = plan.assetCondition?.items || [];
  const updatedItems = current.map(e =>
    (!e.tegevusAasta || e.tegevusAasta === "") ? { ...e, tegevusAasta: ys } : e
  );
  const itemsChanged = updatedItems.some((e, i) => e !== current[i]);

  const updatedLoans = plan.loans.map(l =>
    (!l.algusAasta || l.algusAasta === "") ? { ...l, algusAasta: ys } : l
  );
  const loansChanged = updatedLoans.some((l, i) => l !== plan.loans[i]);

  const currentInvs = plan.investments?.items || [];
  const updatedInvs = currentInvs.map(inv =>
    (!inv.plannedYear) ? { ...inv, plannedYear: year } : inv
  );
  const invsChanged = updatedInvs.some((inv, i) => inv !== currentInvs[i]);

  if (!itemsChanged && !loansChanged && !invsChanged) return plan;

  return {
    ...plan,
    assetCondition: itemsChanged
      ? { ...plan.assetCondition, items: updatedItems }
      : plan.assetCondition,
    loans: loansChanged ? updatedLoans : plan.loans,
    investments: invsChanged
      ? { ...plan.investments, items: updatedInvs }
      : plan.investments,
  };
}

/**
 * Resyncs condition_item investments' plannedYear from the linked
 * assetCondition row's tegevusAasta (the canonical source).
 * Only runs when the linked row has a non-empty tegevusAasta and
 * the derived plannedYear actually differs. Standalone investments
 * are never touched. Returns the same plan reference if nothing changes.
 */
export function syncConditionItemPlannedYears(plan) {
  const seisukord = plan.assetCondition?.items || [];
  const invs = plan.investments?.items || [];
  if (invs.length === 0) return plan;

  const updated = invs.map(inv => {
    if (inv.sourceType !== "condition_item" || !inv.sourceRefId) return inv;
    const linked = seisukord.find(r => r.id === inv.sourceRefId);
    if (!linked || !linked.tegevusAasta) return inv;
    const canonical = Number(linked.tegevusAasta);
    if (!canonical || inv.plannedYear === canonical) return inv;
    return { ...inv, plannedYear: canonical };
  });

  const changed = updated.some((inv, i) => inv !== invs[i]);
  if (!changed) return plan;

  return { ...plan, investments: { ...plan.investments, items: updated } };
}
