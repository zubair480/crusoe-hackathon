/**
 * TypeScript mirror of contracts/v1.schema.json (ThermalDesk exchange contract v1).
 *
 * Property names are the exact snake_case names of the shared contract. Zubair owns the
 * contract; this file only maps it. test/contract.test.ts fails when these constants drift
 * from the JSON Schema, and every RepairJob the tests produce is validated against it.
 */

export const SCHEMA_VERSION = '1.0' as const;

export const INTEGRATION_MODES = ['live', 'sandbox', 'simulated'] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const EVIDENCE_KINDS = [
  'thermal_image',
  'photo',
  'transcript',
  'note',
  'measurement',
  'receipt',
  'equipment_history',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_SOURCES = ['plaud', 'upload', 'import', 'synthetic'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface EvidenceSegment {
  id: string;
  text: string;
  start_seconds?: number;
  end_seconds?: number;
  speaker?: string;
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  asset_id: string | null;
  source: EvidenceSource;
  mode: IntegrationMode;
  uri: string;
  captured_at: string | null;
  text?: string;
  provider_record_id?: string;
  segments?: EvidenceSegment[];
}

export interface Approval {
  reviewer_id: string;
  recommendation_version: number;
  approved_at: string;
  mode: IntegrationMode;
}

export interface Part {
  part_id: string;
  approved_specification: string;
  quantity: number;
  unit: string;
  requires_specification_review: boolean;
}

export const FINDING_SEVERITIES = ['unassessed', 'low', 'medium', 'high'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface Finding {
  id: string;
  description: string;
  evidence_ids: string[];
  severity: FindingSeverity;
  uncertainties: string[];
}

export const RECOMMENDATION_STATUSES = ['draft', 'needs_information', 'approved', 'rejected'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface Recommendation {
  schema_version: typeof SCHEMA_VERSION;
  case_id: string;
  site_id: string;
  asset_id: string;
  recommendation_id: string;
  inspection_id: string;
  version: number;
  status: RecommendationStatus;
  findings: Finding[];
  repair_scope: string;
  parts: Part[];
  missing_information: string[];
  approval: Approval | null;
  analysis_mode: IntegrationMode;
  created_at: string;
}

export const ACTION_TYPES = [
  'supplier_quote',
  'parts_order',
  'technician_contact',
  'booking',
  'schedule_sync',
  'manager_notify',
  'follow_up',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface Authority {
  authority_id: string;
  mode: IntegrationMode;
  currency: string;
  max_total_minor: number;
  allowed_actions: ActionType[];
  expires_at: string;
}

export const ACTION_STATUSES = ['requested', 'pending', 'confirmed', 'failed', 'not_configured'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface ActionReceipt {
  action_id: string;
  job_id: string;
  action_type: ActionType;
  idempotency_key: string;
  mode: IntegrationMode;
  status: ActionStatus;
  provider_reference: string | null;
  evidence_ids: string[];
  detail: string;
  recorded_at: string;
}

export const BOOKING_STATUSES = ['proposed', 'confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface Booking {
  technician_id: string;
  technician_name: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  confirmation_action_id: string | null;
}

export const JOB_STATUSES = [
  'planning',
  'awaiting_authorization',
  'coordinating',
  'scheduled',
  'in_progress',
  'awaiting_verification',
  'closed',
  'blocked',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PARTS_STATUSES = ['not_required', 'not_ordered', 'ordered', 'available', 'delayed'] as const;
export type PartsStatus = (typeof PARTS_STATUSES)[number];

export interface RepairJob {
  schema_version: typeof SCHEMA_VERSION;
  case_id: string;
  site_id: string;
  asset_id: string;
  job_id: string;
  recommendation_id: string;
  recommendation_version: number;
  state_version: number;
  status: JobStatus;
  authority: Authority | null;
  parts_status: PartsStatus;
  booking: Booking | null;
  actions: ActionReceipt[];
  unresolved_findings: string[];
  closure_review: ClosureReview | null;
  updated_at: string;
}

export const REPORTED_STATUSES = ['complete', 'incomplete', 'unknown'] as const;
export type ReportedStatus = (typeof REPORTED_STATUSES)[number];

export interface CompletionEvidence {
  schema_version: typeof SCHEMA_VERSION;
  case_id: string;
  site_id: string;
  asset_id: string;
  completion_id: string;
  job_id: string;
  version: number;
  technician_id: string;
  reported_status: ReportedStatus;
  comments: string;
  evidence: Evidence[];
  unresolved_items: string[];
  created_at: string;
}

export const VERIFICATION_RESULTS = ['ready_for_review', 'needs_information', 'mismatch'] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const CHECK_RESULTS = ['pass', 'fail', 'unknown'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export interface VerificationCheck {
  name: string;
  result: CheckResult;
  evidence_ids: string[];
  detail: string;
}

export interface VerificationDraft {
  schema_version: typeof SCHEMA_VERSION;
  case_id: string;
  site_id: string;
  asset_id: string;
  verification_id: string;
  job_id: string;
  version: number;
  recommendation_version: number;
  completion_id: string;
  completion_version: number;
  result: VerificationResult;
  checks: VerificationCheck[];
  missing_information: string[];
  analysis_mode: IntegrationMode;
  created_at: string;
}

export const CLOSURE_DECISIONS = ['approve_closure', 'keep_open'] as const;
export type ClosureDecision = (typeof CLOSURE_DECISIONS)[number];

export interface ClosureReview {
  reviewer_id: string;
  verification_id: string;
  verification_version: number;
  completion_version: number;
  recommendation_version: number;
  decision: ClosureDecision;
  reviewed_at: string;
  mode: IntegrationMode;
}

/** Saved exchange files and fixtures wrap a data object in this envelope. */
export interface Envelope<K extends string, T> {
  kind: K;
  data: T;
}

export function toRepairJobEnvelope(job: RepairJob): Envelope<'RepairJob', RepairJob> {
  return { kind: 'RepairJob', data: job };
}

const MODE_RANK: Record<IntegrationMode, number> = { simulated: 0, sandbox: 1, live: 2 };

/**
 * True when something granted in `granted` mode covers an action that runs in `requested` mode.
 * A simulated approval or authority covers only simulated actions; live covers everything.
 */
export function modeCovers(granted: IntegrationMode, requested: IntegrationMode): boolean {
  return MODE_RANK[granted] >= MODE_RANK[requested];
}
