import { randomUUID } from "node:crypto";
import { CrusoeInferenceError } from "./crusoe.ts";
import type {
  AnalysisResult, CompletionEvidence, InferenceAdapter, InspectionPackage, Recommendation, RepairJob, VerificationCheck, VerificationDraft,
} from "./types.ts";
import { completionProblems, inspectionProblems } from "./validation.ts";

export * from "./crusoe.ts";
export * from "./fixture.ts";
export type * from "./types.ts";

export interface AnalysisOptions {
  adapter: InferenceAdapter;
  now?: () => Date;
  idFactory?: () => string;
}

function utc(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString();
}

function recommendationBase(inspection: InspectionPackage, options: AnalysisOptions): Omit<Recommendation, "status" | "findings" | "repair_scope" | "parts" | "missing_information" | "analysis_mode"> {
  return {
    schema_version: "1.0",
    case_id: inspection.case_id,
    site_id: inspection.site_id,
    asset_id: inspection.asset_id,
    recommendation_id: `REC-${options.idFactory?.() ?? randomUUID()}`,
    inspection_id: inspection.inspection_id,
    version: 1,
    approval: null,
    created_at: utc(options.now),
  };
}

export async function analyzeInspection(inspection: InspectionPackage, options: AnalysisOptions): Promise<AnalysisResult<Recommendation>> {
  const problems = inspectionProblems(inspection);
  const hasImage = inspection.evidence.some((item) => item.kind === "thermal_image" || item.kind === "photo");
  const blockingProblems = problems.filter((problem) =>
    /duplicated|identifies asset|unknown evidence/i.test(problem) || (!hasImage && /thermal image/i.test(problem)),
  );
  if (blockingProblems.length > 0) {
    return {
      data: {
        ...recommendationBase(inspection, options),
        status: "needs_information",
        findings: inspection.observations.map((item, index) => ({
          id: `FIND-${index + 1}`,
          description: item.text,
          evidence_ids: item.evidence_ids,
          severity: "unassessed",
          uncertainties: ["Input validation is incomplete; no model diagnosis was used."],
        })),
        repair_scope: "No repair scope proposed until the listed information is supplied and reviewed by a qualified person.",
        parts: [],
        missing_information: problems,
        analysis_mode: "simulated",
      },
      telemetry: { provider: "validation", model: null, request_id: null, latency_ms: 0 },
    };
  }

  try {
    const response = await options.adapter.analyze(inspection);
    const evidenceIds = new Set(inspection.evidence.map((item) => item.id));
    const invalidReferences = response.draft.findings.flatMap((finding) => finding.evidence_ids).filter((id) => !evidenceIds.has(id));
    if (invalidReferences.length) throw new CrusoeInferenceError("malformed_output", `Model referenced unknown evidence: ${invalidReferences.join(", ")}`);
    return {
      data: {
        ...recommendationBase(inspection, options),
        status: response.draft.missing_information.length || problems.length ? "needs_information" : "draft",
        findings: response.draft.findings.map((finding, index) => ({ id: `FIND-${index + 1}`, ...finding })),
        repair_scope: response.draft.repair_scope,
        parts: [],
        missing_information: [...new Set([...problems, ...response.draft.missing_information])],
        analysis_mode: response.mode,
      },
      telemetry: response.telemetry,
    };
  } catch (error) {
    const code = error instanceof CrusoeInferenceError ? error.code : "provider_error";
    return {
      data: {
        ...recommendationBase(inspection, options),
        status: "needs_information",
        findings: [],
        repair_scope: "Analysis did not complete. Preserve the case and retry or route it to qualified human review.",
        parts: [],
        missing_information: [`Analysis unavailable (${code}). No downstream action was authorized.`],
        analysis_mode: "simulated",
      },
      telemetry: { provider: "crusoe", model: null, request_id: null, latency_ms: 0, error_code: code },
    };
  }
}

export interface ComparisonOptions {
  mode?: "live" | "sandbox" | "simulated";
  now?: () => Date;
  idFactory?: () => string;
}

export async function compareCompletion(
  job: RepairJob,
  approvedRecommendation: Recommendation,
  completion: CompletionEvidence,
  options: ComparisonOptions = {},
): Promise<AnalysisResult<VerificationDraft>> {
  const problems = completionProblems(job, approvedRecommendation, completion);
  const evidenceIds = completion.evidence.map((item) => item.id);
  const checks: VerificationCheck[] = [
    {
      name: "identity_match",
      result: problems.some((item) => item.includes("mismatch") || item.includes("identifies asset") || item.includes("different recommendation")) ? "fail" : "pass",
      evidence_ids: evidenceIds,
      detail: problems.length ? problems.join(" ") : "Case, site, job, asset, and recommendation identities match.",
    },
    {
      name: "completion_reported",
      result: completion.reported_status === "complete" ? "pass" : completion.reported_status === "incomplete" ? "fail" : "unknown",
      evidence_ids: evidenceIds,
      detail: `Technician-reported status is ${completion.reported_status}; this is not an autonomous safety certification.`,
    },
    {
      name: "completion_evidence_present",
      result: completion.evidence.length ? "pass" : "unknown",
      evidence_ids: evidenceIds,
      detail: completion.evidence.length ? `${completion.evidence.length} evidence item(s) supplied.` : "No completion evidence supplied.",
    },
  ];
  const missing = [...completion.unresolved_items];
  if (!completion.evidence.length) missing.push("Completion photos, receipts, measurements, or technician evidence are required as applicable.");
  const result = problems.length ? "mismatch" : missing.length || completion.reported_status !== "complete" ? "needs_information" : "ready_for_review";
  const draft: VerificationDraft = {
    schema_version: "1.0",
    case_id: job.case_id,
    site_id: job.site_id,
    asset_id: job.asset_id,
    verification_id: `VERIFY-${options.idFactory?.() ?? randomUUID()}`,
    job_id: job.job_id,
    version: 1,
    recommendation_version: approvedRecommendation.version,
    completion_id: completion.completion_id,
    completion_version: completion.version,
    result,
    checks,
    missing_information: [...new Set([...problems, ...missing])],
    analysis_mode: options.mode ?? "simulated",
    created_at: utc(options.now),
  };
  return { data: draft, telemetry: { provider: "validation", model: null, request_id: null, latency_ms: 0 } };
}
