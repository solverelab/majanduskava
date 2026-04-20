/**
 * Normalizes the investments field: prefers investments.items,
 * falls back to investmentsPipeline.items, removes investmentsPipeline.
 */
export function normalizeInvestmentsField(candidateState) {
  candidateState.investments = {
    items:
      candidateState.investments?.items ??
      candidateState.investmentsPipeline?.items ??
      [],
  };
  delete candidateState.investmentsPipeline;
}

/**
 * Removes embedded investment fields from assetCondition rows.
 * These fields live in investments.items after migration.
 */
export function cleanAssetConditionInvestmentFields(importedSeisukord) {
  return importedSeisukord.map(
    ({ investeering: _, invNimetus: __, invMaksumus: ___, rahpiiri: ____, ...rest }) => rest
  );
}
