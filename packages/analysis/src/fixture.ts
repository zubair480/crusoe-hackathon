import type { InferenceAdapter, InferenceResponse, InspectionPackage } from "./types.ts";

export class FixtureAnalysisAdapter implements InferenceAdapter {
  async analyze(inspection: InspectionPackage): Promise<InferenceResponse> {
    const evidenceIds = inspection.evidence.map((item) => item.id);
    return {
      mode: "simulated",
      telemetry: { provider: "fixture", model: "deterministic-fixture-v1", request_id: null, latency_ms: 0 },
      draft: {
        findings: inspection.observations.map((observation) => ({
          description: `SIMULATED: ${observation.text}`,
          evidence_ids: observation.evidence_ids.filter((id) => evidenceIds.includes(id)),
          severity: "unassessed",
          uncertainties: ["Fixture inference is not a technical diagnosis."],
        })),
        repair_scope: "No repair scope proposed until missing inspection information is supplied and reviewed by a qualified person.",
        missing_information: [...inspection.missing_information],
      },
    };
  }
}
