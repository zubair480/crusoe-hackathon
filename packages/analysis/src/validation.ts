import type { CompletionEvidence, InspectionPackage, Recommendation, RepairJob } from "./types.ts";

const MEASUREMENT_PATTERN = /(-?\d+(?:\.\d+)?)\s*(°?\s*(?:c|f|k)|celsius|fahrenheit|kelvin)\b/i;

export function inspectionProblems(inspection: InspectionPackage): string[] {
  const problems = [...inspection.missing_information];
  const evidenceIds = new Set<string>();
  let hasImage = false;
  let hasMeasurement = false;

  for (const evidence of inspection.evidence) {
    if (!evidence.id || evidenceIds.has(evidence.id)) problems.push(`Evidence ID is missing or duplicated: ${evidence.id || "(empty)"}`);
    evidenceIds.add(evidence.id);
    if (evidence.asset_id !== null && evidence.asset_id !== inspection.asset_id) {
      problems.push(`Evidence ${evidence.id} identifies asset ${evidence.asset_id}, expected ${inspection.asset_id}.`);
    }
    if (evidence.kind === "thermal_image" || evidence.kind === "photo") hasImage = true;
    if (evidence.kind === "measurement" && evidence.text && MEASUREMENT_PATTERN.test(evidence.text)) hasMeasurement = true;
  }

  if (!hasImage) problems.push("Thermal image evidence is not available.");
  if (!hasMeasurement) problems.push("A calibrated numeric temperature measurement with units is not available.");
  for (const observation of inspection.observations) {
    for (const id of observation.evidence_ids) {
      if (!evidenceIds.has(id)) problems.push(`Observation ${observation.id} references unknown evidence ${id}.`);
    }
  }
  return [...new Set(problems)];
}

export function completionProblems(job: RepairJob, recommendation: Recommendation, completion: CompletionEvidence): string[] {
  const problems: string[] = [];
  const identities: Array<[string, string, string]> = [
    ["case", job.case_id, completion.case_id],
    ["site", job.site_id, completion.site_id],
    ["asset", job.asset_id, completion.asset_id],
    ["job", job.job_id, completion.job_id],
  ];
  for (const [name, expected, actual] of identities) {
    if (expected !== actual) problems.push(`${name} mismatch: expected ${expected}, received ${actual}.`);
  }
  if (job.recommendation_id !== recommendation.recommendation_id) problems.push("Repair job references a different recommendation.");
  if (job.recommendation_version !== recommendation.version) problems.push("Repair job references a different recommendation version.");
  for (const evidence of completion.evidence) {
    if (evidence.asset_id !== null && evidence.asset_id !== job.asset_id) {
      problems.push(`Completion evidence ${evidence.id} identifies asset ${evidence.asset_id}, expected ${job.asset_id}.`);
    }
  }
  return problems;
}
