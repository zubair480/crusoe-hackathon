import type {
  ActionReceipt,
  ActionStatus,
  ActionType,
  Approval,
  Authority,
  ClosureReview,
  CompletionEvidence,
  Finding,
  IntegrationMode,
  JobStatus,
  Part,
  PartsStatus,
  Recommendation,
  RepairJob,
  VerificationDraft,
} from './contract.js';

/* ------------------------------------------------------------------ */
/* Clock, configuration, context                                       */
/* ------------------------------------------------------------------ */

export interface Clock {
  now(): Date;
}

export interface CoordinationConfig {
  /** How many technicians are ranked for one booking round. */
  shortlist_size: number;
  /** How long a technician has to answer an offer before the next one is contacted. */
  technician_response_minutes: number;
  /** Required gap between the parts delivery estimate and the appointment start. */
  parts_buffer_minutes: number;
  /** How long after the appointment end completion evidence is expected. */
  completion_grace_minutes: number;
  /** Reminders sent for missing completion evidence before the manager is escalated to. */
  completion_reminder_limit: number;
  /** How long a completed job may wait for verification before the manager is reminded. */
  verification_reminder_minutes: number;
  /** Delay before a failed schedule sync or notification is retried. */
  retry_delay_minutes: number;
  /** Maximum attempts for one logical action. */
  max_action_attempts: number;
  /** Appointments are searched from now until this many days ahead. */
  scheduling_horizon_days: number;
}

export const DEFAULT_CONFIG: CoordinationConfig = {
  shortlist_size: 3,
  technician_response_minutes: 60,
  parts_buffer_minutes: 60,
  completion_grace_minutes: 120,
  completion_reminder_limit: 2,
  verification_reminder_minutes: 24 * 60,
  retry_delay_minutes: 15,
  max_action_attempts: 3,
  scheduling_horizon_days: 14,
};

export interface CoordinationContext {
  repository: JobRepository;
  /** Defaults to the system clock. Tests and the demo inject a controlled clock. */
  clock?: Clock;
  config?: Partial<CoordinationConfig>;
}

export interface JobRequirements {
  /** Qualifications a technician must hold. Supplied by the customer, never inferred. */
  required_qualifications: string[];
  duration_minutes: number;
  earliest_start_at: string | null;
  latest_end_at: string | null;
}

export interface CreateRepairJobInput {
  recommendation: Recommendation;
  authority: Authority | null;
  /** Defaults to `JOB-<recommendation_id>`. */
  job_id?: string;
  requirements?: Partial<JobRequirements>;
}

/* ------------------------------------------------------------------ */
/* Typed workflow events (input of advanceRepairJob)                   */
/* ------------------------------------------------------------------ */

export interface WorkflowEventBase {
  /** Caller-supplied unique id. Re-sending the same id returns the stored outcome. */
  event_id: string;
  /** When the fact happened (ISO 8601). Defaults to the coordinator clock. */
  occurred_at?: string;
  /** Who or what reported it, for example "web:reviewer-screen" or "sms:inbound". */
  reported_by?: string;
  /** Optional optimistic-concurrency guard for events raised from a displayed job. */
  expected_state_version?: number;
}

export interface AuthorityConfiguredEvent extends WorkflowEventBase {
  type: 'authority_configured';
  authority: Authority;
}

export interface RecommendationRevisedEvent extends WorkflowEventBase {
  type: 'recommendation_revised';
  recommendation: Recommendation;
}

export interface RecommendationApprovedEvent extends WorkflowEventBase {
  type: 'recommendation_approved';
  recommendation: Recommendation;
}

export interface TechnicianRespondedEvent extends WorkflowEventBase {
  type: 'technician_responded';
  technician_id: string;
  response: 'accepted' | 'declined';
  /** Provider reference of the inbound reply. Kept as evidence of the booking. */
  response_reference: string;
  response_text?: string;
  /** Mode of the channel the reply arrived through. */
  mode: IntegrationMode;
}

export interface TechnicianCancelledEvent extends WorkflowEventBase {
  type: 'technician_cancelled';
  technician_id: string;
  reason: string;
  cancellation_reference?: string;
}

export type PartsOrderStatus = 'accepted' | 'rejected' | 'shipped' | 'delivered' | 'delayed';

export interface PartsOrderUpdatedEvent extends WorkflowEventBase {
  type: 'parts_order_updated';
  part_id: string;
  order_status: PartsOrderStatus;
  estimated_delivery_at?: string;
  provider_reference?: string;
  detail?: string;
}

export interface WorkStartedEvent extends WorkflowEventBase {
  type: 'work_started';
  technician_id: string;
}

export interface CompletionEvidenceReceivedEvent extends WorkflowEventBase {
  type: 'completion_evidence_received';
  completion: CompletionEvidence;
}

export interface VerificationDraftReceivedEvent extends WorkflowEventBase {
  type: 'verification_draft_received';
  verification: VerificationDraft;
}

export interface ClosureReviewRecordedEvent extends WorkflowEventBase {
  type: 'closure_review_recorded';
  review: ClosureReview;
}

export interface ExceptionApprovedEvent extends WorkflowEventBase {
  type: 'exception_approved';
  /** The only exception the coordinator understands: book before parts are confirmed. */
  exception: 'schedule_before_parts';
  approved_by: string;
  reason: string;
}

export interface JobCancelledEvent extends WorkflowEventBase {
  type: 'job_cancelled';
  cancelled_by: string;
  reason: string;
}

export type WorkflowEvent =
  | AuthorityConfiguredEvent
  | RecommendationRevisedEvent
  | RecommendationApprovedEvent
  | TechnicianRespondedEvent
  | TechnicianCancelledEvent
  | PartsOrderUpdatedEvent
  | WorkStartedEvent
  | CompletionEvidenceReceivedEvent
  | VerificationDraftReceivedEvent
  | ClosureReviewRecordedEvent
  | ExceptionApprovedEvent
  | JobCancelledEvent;

export type WorkflowEventType = WorkflowEvent['type'];

export const WORKFLOW_EVENT_TYPES: readonly WorkflowEventType[] = [
  'authority_configured',
  'recommendation_revised',
  'recommendation_approved',
  'technician_responded',
  'technician_cancelled',
  'parts_order_updated',
  'work_started',
  'completion_evidence_received',
  'verification_draft_received',
  'closure_review_recorded',
  'exception_approved',
  'job_cancelled',
];

/* ------------------------------------------------------------------ */
/* External action adapters (all injected)                             */
/* ------------------------------------------------------------------ */

/**
 * What an adapter reports about one external action.
 *
 * `confirmed` means the provider confirmed the outcome. `requested` and `pending` mean the
 * request was submitted but the outcome is not known yet. Adapters return `failed` for a
 * definite failure and throw only when the outcome is unknown.
 */
export interface AdapterOutcome {
  status: ActionStatus;
  provider_reference: string | null;
  detail: string;
  /** JSON-serialisable provider response. Stored as evidence of the outcome. */
  raw?: unknown;
}

export interface AdapterIdentity {
  mode: IntegrationMode;
  /**
   * True when the provider deduplicates on the idempotency key, so an interrupted call can be
   * repeated safely. When false, an interrupted call is never repeated automatically.
   */
  deduplicates_by_key?: boolean;
}

export interface QuoteRequest {
  idempotency_key: string;
  job_id: string;
  part_id: string;
  approved_specification: string;
  quantity: number;
  unit: string;
}

export interface Quote {
  offered_part_id: string;
  offered_specification: string;
  quantity_available: number;
  unit_price_minor: number;
  currency: string;
  estimated_delivery_at: string | null;
  valid_until: string | null;
}

export interface QuoteOutcome extends AdapterOutcome {
  quote: Quote | null;
}

export interface OrderRequest {
  idempotency_key: string;
  job_id: string;
  part_id: string;
  approved_specification: string;
  quantity: number;
  unit: string;
  unit_price_minor: number;
  total_minor: number;
  currency: string;
  quote_reference: string | null;
}

export interface OrderOutcome extends AdapterOutcome {
  estimated_delivery_at: string | null;
}

export interface SupplierAdapter extends AdapterIdentity {
  supplier_id: string;
  name: string;
  requestQuote(request: QuoteRequest): Promise<QuoteOutcome>;
  placeOrder(request: OrderRequest): Promise<OrderOutcome>;
}

export interface AvailabilityWindow {
  start_at: string;
  end_at: string;
}

export interface Technician {
  technician_id: string;
  name: string;
  qualifications: string[];
  /** Sites the customer approved this technician for. `*` means every site. */
  site_ids: string[];
  distance_km?: number;
  availability: AvailabilityWindow[];
  contact: { channel: string; address: string };
  active: boolean;
}

/** The customer's approved technician roster. The coordinator never looks elsewhere. */
export interface TechnicianRoster {
  mode: IntegrationMode;
  listTechnicians(query: { site_id: string; asset_id: string }): Promise<Technician[]>;
}

export type MessagePurpose = 'technician_offer' | 'manager_update' | 'follow_up';

export interface OutboundMessage {
  idempotency_key: string;
  job_id: string;
  purpose: MessagePurpose;
  recipient: { role: 'technician' | 'manager'; id: string; name: string; address: string };
  subject: string;
  body: string;
}

export interface CommunicationAdapter extends AdapterIdentity {
  /** For example "sms", "email" or "simulated". */
  channel: string;
  send(message: OutboundMessage): Promise<AdapterOutcome>;
}

export type ScheduleSyncReason =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'closure_verified'
  | 'job_cancelled';

/** One row of the agreed schedule workbook. `job_id` is the row key. */
export interface ScheduleRow {
  job_id: string;
  asset_id: string;
  site_id: string;
  technician_id: string | null;
  technician_name: string | null;
  start_at: string | null;
  end_at: string | null;
  parts_status: PartsStatus;
  job_status: JobStatus;
  last_updated_at: string;
}

export interface ScheduleSyncRequest {
  job_id: string;
  idempotency_key: string;
  reason: ScheduleSyncReason;
  row: ScheduleRow;
  job: RepairJob;
}

/** Zubair's Excel adapter. The coordinator waits for and records the receipt it returns. */
export interface ScheduleAdapter extends AdapterIdentity {
  syncSchedule(request: ScheduleSyncRequest): Promise<ActionReceipt>;
}

export interface ManagerContact {
  manager_id: string;
  name: string;
  address: string;
}

export interface CoordinationAdapters {
  /** The suppliers the customer allows. Parts are sourced from these and nowhere else. */
  suppliers: SupplierAdapter[];
  roster: TechnicianRoster | null;
  communication: CommunicationAdapter | null;
  schedule: ScheduleAdapter | null;
  manager: ManagerContact | null;
}

export interface CoordinateOptions {
  /**
   * The recommendation as the application currently stores it. When supplied it is compared
   * with the approved snapshot; any difference invalidates the approval before any action.
   */
  current_recommendation?: Recommendation;
}

/* ------------------------------------------------------------------ */
/* Persisted record                                                    */
/* ------------------------------------------------------------------ */

export interface ApprovedScope {
  recommendation_id: string;
  version: number;
  /** Hash of the technical scope and parts. A different hash needs a new approval. */
  scope_fingerprint: string;
  repair_scope: string;
  parts: Part[];
  findings: Finding[];
  approval: Approval;
}

export interface ApprovalState {
  valid: boolean;
  /** Why the approval stopped covering the job, when it did. */
  invalid_reason: string | null;
  invalidated_at: string | null;
}

export type QuoteClassification =
  | 'match'
  | 'substitution'
  | 'insufficient_quantity'
  | 'currency_mismatch'
  | 'unavailable';

export interface QuoteRecord {
  supplier_id: string;
  supplier_name: string;
  action_id: string;
  mode: IntegrationMode;
  status: ActionStatus;
  classification: QuoteClassification;
  quote: Quote | null;
  provider_reference: string | null;
}

export type PurchaseOutcome = 'requested' | 'pending' | 'confirmed' | 'failed' | 'rejected';

export interface OrderRecord {
  supplier_id: string;
  supplier_name: string;
  action_id: string;
  mode: IntegrationMode;
  provider_reference: string | null;
  /** Price, availability, delivery estimate and purchase outcome are kept separately. */
  unit_price_minor: number;
  total_minor: number;
  currency: string;
  quantity_available_at_quote: number;
  estimated_delivery_at: string | null;
  purchase_outcome: PurchaseOutcome;
  delivered_at: string | null;
}

export type SourcingStatus =
  | 'pending'
  | 'needs_review'
  | 'unavailable'
  | 'over_authority'
  | 'ordered'
  | 'delayed'
  | 'delivered'
  | 'superseded';

export interface PartSourcing {
  part_id: string;
  recommendation_version: number;
  approved_specification: string;
  quantity: number;
  unit: string;
  status: SourcingStatus;
  status_detail: string;
  /** Sourcing round. A manual retry of a blocked job asks the suppliers again. */
  round: number;
  quotes: QuoteRecord[];
  excluded_supplier_ids: string[];
  order: OrderRecord | null;
}

export type OfferStatus =
  | 'awaiting_response'
  | 'send_failed'
  | 'declined'
  | 'no_response'
  | 'accepted'
  | 'confirmed'
  | 'cancelled'
  | 'superseded';

export interface TechnicianOffer {
  offer_id: string;
  /** Booking round. A cancellation or a parts delay starts the next round. */
  generation: number;
  technician_id: string;
  technician_name: string;
  contact: { channel: string; address: string };
  start_at: string;
  end_at: string;
  status: OfferStatus;
  offer_action_id: string | null;
  respond_by: string | null;
  acceptance_evidence_id: string | null;
  acceptance_reference: string | null;
  acceptance_mode: IntegrationMode | null;
  booking_action_id: string | null;
  closed_reason: string | null;
}

export interface ShortlistEntry {
  technician_id: string;
  technician_name: string;
  rank: number;
  start_at: string;
  end_at: string;
  distance_km: number | null;
}

export interface ShortlistRecord {
  generation: number;
  built_at: string;
  earliest_start_at: string;
  latest_end_at: string;
  required_qualifications: string[];
  selected: ShortlistEntry[];
  /** Roster members that were not shortlisted, with the reason. Kept for audit. */
  excluded: { technician_id: string; reason: string }[];
}

export interface LedgerEntry {
  idempotency_key: string;
  logical_key: string;
  attempt: number;
  action_id: string;
  action_type: ActionType;
  /** `intent` is written before the adapter is called, `recorded` after its outcome. */
  state: 'intent' | 'recorded';
  requested_at: string;
  recorded_at: string | null;
  status: ActionStatus | null;
  /** JSON data the step needs to rebuild its state when the action is replayed. */
  data: unknown;
}

export interface OutcomeEvidence {
  evidence_id: string;
  action_id: string | null;
  kind: 'provider_response' | 'technician_response' | 'cancellation' | 'adapter_error';
  mode: IntegrationMode;
  captured_at: string;
  content: unknown;
  content_sha256: string;
}

export type FollowUpKind =
  | 'technician_response'
  | 'parts_delivery'
  | 'completion_evidence'
  | 'verification_pending'
  | 'schedule_sync_retry';

export interface FollowUp {
  follow_up_id: string;
  kind: FollowUpKind;
  /** Identifies what the follow-up is about, for example an offer id or a part id. */
  subject: string;
  due_at: string;
  status: 'pending' | 'done' | 'cancelled';
  attempt: number;
  created_at: string;
  closed_at: string | null;
  outcome: string | null;
}

export type EscalationTarget = 'manager' | 'reviewer' | 'authority';

export interface Escalation {
  escalation_id: string;
  code: string;
  to: EscalationTarget;
  subject: string;
  detail: string;
  raised_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export interface ApprovedException {
  exception: 'schedule_before_parts';
  approved_by: string;
  reason: string;
  approved_at: string;
  source_event_id: string;
}

export interface CompletionAssessment {
  completion_id: string;
  version: number;
  /** Evidence ids whose asset differs from the job's asset. Never rewritten. */
  asset_mismatch_evidence_ids: string[];
  issues: string[];
  acceptable_for_closure: boolean;
}

export interface TimelineEvent {
  event_id: string;
  sequence: number;
  job_id: string;
  kind: 'workflow_event' | 'execution';
  type: string;
  occurred_at: string;
  recorded_at: string;
  summary: string;
  status_after: JobStatus;
  /** State version of the job once this event was persisted. */
  state_version: number;
  outcome: 'applied' | 'rejected';
  rejection: { code: string; message: string } | null;
  /** The caller's event id, for workflow events. */
  source_event_id: string | null;
  /** Hash of the event payload. The same event id with another payload is a conflict. */
  payload_fingerprint: string | null;
  action_id: string | null;
  mode: IntegrationMode | null;
  data: unknown;
}

export interface JobCounters {
  action: number;
  event: number;
  evidence: number;
  follow_up: number;
  escalation: number;
  offer: number;
}

export interface JobRecord {
  record_version: 1;
  job: RepairJob;
  approved_scope: ApprovedScope;
  approval_state: ApprovalState;
  requirements: JobRequirements;
  sourcing: PartSourcing[];
  generation: number;
  shortlists: ShortlistRecord[];
  offers: TechnicianOffer[];
  excluded_technician_ids: string[];
  exceptions: ApprovedException[];
  completions: CompletionEvidence[];
  completion_assessments: CompletionAssessment[];
  verifications: VerificationDraft[];
  closure_reviews: ClosureReview[];
  ledger: LedgerEntry[];
  outcome_evidence: OutcomeEvidence[];
  follow_ups: FollowUp[];
  escalations: Escalation[];
  /** Escalations the manager has already been told about. */
  notified_escalation_ids: string[];
  events: TimelineEvent[];
  /** Set by an event that leaves work for coordinateRepair. Cleared when it has run. */
  needs_coordination: boolean;
  counters: JobCounters;
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

/**
 * Persistent store for job records. `save` is a compare-and-swap on `job.state_version`,
 * which serialises state transitions even across processes.
 */
export interface JobRepository {
  insert(record: JobRecord): Promise<void>;
  load(job_id: string): Promise<JobRecord | null>;
  save(record: JobRecord, expected_state_version: number): Promise<void>;
  list(): Promise<JobRecord[]>;
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export interface JobDetail {
  job: RepairJob;
  approval_valid: boolean;
  approval_invalid_reason: string | null;
  approved_scope: ApprovedScope;
  sourcing: PartSourcing[];
  generation: number;
  shortlists: ShortlistRecord[];
  offers: TechnicianOffer[];
  open_escalations: Escalation[];
  resolved_escalations: Escalation[];
  pending_follow_ups: FollowUp[];
  exceptions: ApprovedException[];
  current_completion: CompletionEvidence | null;
  current_completion_assessment: CompletionAssessment | null;
  current_verification: VerificationDraft | null;
  outcome_evidence: OutcomeEvidence[];
  timeline: TimelineEvent[];
}

export interface FollowUpResult {
  job_id: string;
  follow_up_id: string;
  kind: FollowUpKind;
  outcome: string;
}

export interface WorkerTickResult {
  /** Which runtime executed the work. BAND is not used; this is the baseline job queue. */
  runtime: 'job_queue';
  ran_at: string;
  follow_ups: FollowUpResult[];
  coordinated_job_ids: string[];
}
