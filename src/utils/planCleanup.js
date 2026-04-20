/**
 * Removes orphan linked loans — loans whose sepiiriostudInvId points to
 * a missing investment, or an investment whose fundingPlan no longer contains "Laen".
 * Returns the same plan reference if no orphans are found.
 */
export function cleanupOrphanLinkedLoans(plan) {
  const orphanLoanIds = plan.loans
    .filter(l => l.sepiiriostudInvId)
    .filter(l => {
      const inv = plan.investments.items.find(i =>
        i.sourceRefId === l.sepiiriostudInvId || i.id === l.sepiiriostudInvId
      );
      if (!inv) return true;
      return !(inv.fundingPlan || []).some(fp => fp.source === "Laen");
    })
    .map(l => l.id);

  if (orphanLoanIds.length === 0) return plan;
  return { ...plan, loans: plan.loans.filter(l => !orphanLoanIds.includes(l.id)) };
}
