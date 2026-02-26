// solvere-modules/majanduskava/src/types.ts

export type PlanState = any; // sinu plan state (UI state)

export type PlanMetrics = {
  funds: {
    repairFundClosingEUR: number;
    reserveClosingEUR: number;
    reserveRequiredEUR: number;
    reservePlannedEUR: number;
    repairFundIncomePeriodEUR: number;
  };
  totals: {
    netOperationalMonthlyEUR: number;
    ownersNeedMonthlyEUR: number;
    costPeriodEUR?: number;
    costMonthlyEUR?: number;
  };
  loans: {
    serviceMonthlyEUR: number;
  };
  investments: {
    rfOutflowThisYearEUR: number;
  };
  controls: {
    issues: Array<{
      severity: "error" | "warning" | "info";
      code: string;
      message: string;
      path?: string;
    }>;
    hasErrors: boolean;
  };
};
