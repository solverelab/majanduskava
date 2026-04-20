import { mkLoan } from "../domain/planSchema";

// Pure helper: returns updated loans array with synced/created loan for investeeringId
export const syncLoan = (p, investeeringId, laenSumma) => {
  const olemas = p.loans.find(l => l.sepiiriostudInvId === investeeringId);
  if (olemas) {
    return p.loans.map(l =>
      l.sepiiriostudInvId === investeeringId ? { ...l, principalEUR: laenSumma } : l
    );
  }
  const y = String(p.period.year || new Date().getFullYear());
  return [...p.loans, {
    ...mkLoan({ startYM: `${y}-01` }),
    liik: "Investeerimislaen",
    algusAasta: y,
    sepiiriostudInvId: investeeringId,
    principalEUR: laenSumma,
    termMonths: 12,
  }];
};
