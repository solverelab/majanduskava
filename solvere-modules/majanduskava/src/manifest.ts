// solvere-modules/majanduskava/src/manifest.ts

import type { SolvereModuleManifestV1 } from "../../../packages/solvere-core/src/solvereCoreV1";

export const manifest: SolvereModuleManifestV1 = {
  schemaVersion: "moduleManifest/v1",
  moduleId: "majanduskava",
  moduleVersion: "0.1.0",
  title: "Majanduskava",
  description: "Korteriühistu majanduskava riskihinnang ja parandus-actionid.",
  stateSchemaId: "majanduskava/state/v1",
  metricsSchemaId: "majanduskava/metrics/v1",
  defaultPolicyPreset: "BALANCED",
  policyPresets: ["BALANCED", "CONSERVATIVE", "LOAN_FRIENDLY"],
};
