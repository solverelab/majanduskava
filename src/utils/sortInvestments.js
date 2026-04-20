// Canonical investment sort: plannedYear ASC, totalCostEUR DESC, name ASC
export function compareInvestmentsCanonical(a, b) {
  return (a.plannedYear || 0) - (b.plannedYear || 0)
    || (b.totalCostEUR || 0) - (a.totalCostEUR || 0)
    || (a.name || "").localeCompare(b.name || "");
}

export function sortInvestmentsCanonical(items) {
  return items.slice().sort(compareInvestmentsCanonical);
}
