export type IntegrationMode = "live" | "sandbox" | "simulated";

export interface EvidenceSegment {
  id: string;
  text: string;
  start_seconds?: number;
  end_seconds?: number;
  speaker?: string;
}

export interface Evidence {
  id: string;
  kind: "thermal_image" | "photo" | "transcript" | "note" | "measurement" | "receipt" | "equipment_history";
  asset_id: string | null;
  source: "plaud" | "upload" | "import" | "synthetic";
  mode: IntegrationMode;
  uri: string;
  captured_at: string | null;
  text?: string;
  provider_record_id?: string;
  segments?: EvidenceSegment[];
}

export interface Observation {
  id: string;
  text: string;
  evidence_ids: string[];
  segment_ids: string[];
  needs_review: boolean;
}

export interface InspectionPackage {
  schema_version: "1.0";
  case_id: string;
  site_id: string;
  asset_id: string;
  inspection_id: string;
  evidence: Evidence[];
  observations: Observation[];
  missing_information: string[];
  created_at: string;
}

export interface Finding {
  id: string;
  description: string;
  evidence_ids: string[];
  severity: "unassessed" | "low" | "medium" | "high";
  uncertainties: string[];
}

export interface Part {
  part_id: string;
  approved_specification: string;
  quantity: number;
  unit: string;
  requires_specification_review: boolean;
}

export interface Recommendation {
  schema_version: "1.0";
  case_id: string;
  site_id: string;
  asset_id: string;
  recommendation_id: string;
  inspection_id: string;
  version: number;
  status: "draft" | "needs_information" | "approved" | "rejected";
  findings: Finding[];
  repair_scope: string;
  parts: Part[];
  missing_information: string[];
  approval: null;
  analysis_mode: IntegrationMode;
  created_at: string;
}

export interface RepairJob {
  schema_version: "1.0";
  case_id: string;
  site_id: string;
  asset_id: string;
  job_id: string;
  recommendation_id: string;
  recommendation_version: number;
  state_version: number;
  status: string;
  authority: unknown;
  parts_status: string;
  booking: unknown;
  actions: unknown[];
  unresolved_findings: string[];
  closure_review: unknown;
  updated_at: string;
}

export interface CompletionEvidence {
  schema_version: "1.0";
  case_id: string;
  site_id: string;
  asset_id: string;
  completion_id: string;
  job_id: string;
  version: number;
  technician_id: string;
  reported_status: "complete" | "incomplete" | "unknown";
  comments: string;
  evidence: Evidence[];
  unresolved_items: string[];
  created_at: string;
}

export interface VerificationCheck {
  name: string;
  result: "pass" | "fail" | "unknown";
  evidence_ids: string[];
  detail: string;
}

export interface VerificationDraft {
  schema_version: "1.0";
  case_id: string;
  site_id: string;
  asset_id: string;
  verification_id: string;
  job_id: string;
  version: number;
  recommendation_version: number;
  completion_id: string;
  completion_version: number;
  result: "ready_for_review" | "needs_information" | "mismatch";
  checks: VerificationCheck[];
  missing_information: string[];
  analysis_mode: IntegrationMode;
  created_at: string;
}

export interface AnalysisTelemetry {
  provider: "crusoe" | "fixture" | "validation";
  model: string | null;
  request_id: string | null;
  latency_ms: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error_code?: "not_configured" | "timeout" | "rate_limited" | "provider_error" | "malformed_output";
}

export interface AnalysisResult<T> {
  data: T;
  telemetry: AnalysisTelemetry;
}

export interface DraftFinding {
  description: string;
  evidence_ids: string[];
  severity: "unassessed" | "low" | "medium" | "high";
  uncertainties: string[];
}

export interface InferenceDraft {
  findings: DraftFinding[];
  repair_scope: string;
  missing_information: string[];
}

export interface InferenceResponse {
  draft: InferenceDraft;
  telemetry: AnalysisTelemetry;
  mode: IntegrationMode;
}

export interface InferenceAdapter {
  analyze(inspection: InspectionPackage): Promise<InferenceResponse>;
}
