export function checkPlanConsistency(plan) {
  const warnings = [];
  const items = plan.assetCondition?.items || [];
  const investments = plan.investments?.items || [];
  const loans = plan.loans || [];

  for (const inv of investments) {
    if (inv.sourceType !== "condition_item" || !inv.sourceRefId) continue;
    const cond = items.find(r => r.id === inv.sourceRefId);
    if (!cond) {
      warnings.push({ code: "INV_ORPHAN_CONDITION", invId: inv.id, sourceRefId: inv.sourceRefId });
      continue;
    }
    if ((Number(cond.eeldatavKulu) || 0) !== (inv.totalCostEUR || 0)) {
      warnings.push({
        code: "INV_AMOUNT_MISMATCH", invId: inv.id, conditionId: cond.id,
        conditionAmount: Number(cond.eeldatavKulu) || 0, invAmount: inv.totalCostEUR || 0,
      });
    }
    const expectedName = cond.ese + (cond.tegevus ? " — " + cond.tegevus : "");
    if (inv.name !== expectedName) {
      warnings.push({
        code: "INV_NAME_MISMATCH", invId: inv.id, conditionId: cond.id,
        conditionName: expectedName, invName: inv.name,
      });
    }
    if ((Number(cond.tegevusAasta) || 0) !== (inv.plannedYear || 0)) {
      warnings.push({
        code: "INV_YEAR_MISMATCH", invId: inv.id, conditionId: cond.id,
        conditionYear: Number(cond.tegevusAasta) || 0, invYear: inv.plannedYear || 0,
      });
    }
  }

  for (const loan of loans) {
    if (!loan.sepiiriostudInvId) continue;
    const inv = investments.find(i =>
      i.id === loan.sepiiriostudInvId || i.sourceRefId === loan.sepiiriostudInvId
    );
    if (!inv) {
      warnings.push({ code: "LOAN_ORPHAN", loanId: loan.id, sepiiriostudInvId: loan.sepiiriostudInvId });
      continue;
    }
    const hasFpLoan = (inv.fundingPlan || []).some(fp => fp.source === "Laen");
    if (!hasFpLoan) {
      warnings.push({ code: "FUNDING_PLAN_MISSING_LOAN", invId: inv.id, loanId: loan.id });
    }
  }

  return warnings;
}
