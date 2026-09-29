import {
  CLOSURE_DECISIONS,
  INTEGRATION_MODES,
  REPORTED_STATUSES,
  SCHEMA_VERSION,
  VERIFICATION_RESULTS,
  modeCovers,
  type CompletionEvidence,
  type IntegrationMode,
  type JobStatus,
  type Recommendation,
  type RepairJob,
} from './contract.js';
import { systemClock } from './clock.js';
import {
  ApprovalError,
  ContractViolationError,
  CoordinationError,
  DuplicateJobError,
  EventRejectedError,
  JobNotFoundError,
} from './errors.js';
import {
  checkActionAllowed,
  executeAction,
  labelDetail,
  recordNotConfigured,
  type ActionRefusal,
  type ActionResult,
} from './executor.js';
import { assertAuthorityShape, assertRecommendationShape, scopeFingerprint, snapshotScope } from './gate.js';
import { composeManagerUpdate } from './manager.js';
import {
  activeSourcing,
  buildShortlist,
  classifyQuote,
  committedSpendMinor,
  computePartsStatus,
  partsSupportAppointment,
  planParts,
  rankQuotes,
} from './planning.js';
import { JobRun, resolveConfig, withJobLock } from './run.js';
import {
  WORKFLOW_EVENT_TYPES,
  type CompletionAssessment,
  type CoordinateOptions,
  type CoordinationAdapters,
  type CoordinationContext,
  type CreateRepairJobInput,
  type FollowUp,
  type FollowUpResult,
  type JobDetail,
  type JobRecord,
  type JobRequirements,
  type PartSourcing,
  type Quote,
  type ScheduleRow,
  type ScheduleSyncReason,
  type TechnicianOffer,
  type TimelineEvent,
  type WorkerTickResult,
  type WorkflowEvent,
} from './types.js';
import { addMinutes, clone, fingerprint, formatMoney, normaliseSpecification, pad, parseTime, toIso } from './util.js';

/** Statuses in which parts and technicians are still being arranged. */
const PLANNING_STATUSES: readonly JobStatus[] = ['planning', 'awaiting_authorization', 'coordinating', 'blocked'];
const AUTHORITY_CODES = [
  'authority_missing',
  'authority_expired',
  'action_not_authorized',
  'mode_not_authorized',
  'spending_limit_exceeded',
  'verdict_blocked',
];
const APPROVAL_CODES = [
  'reapproval_required',
  'approval_invalid',
  'approval_version_mismatch',
  'approval_mode_insufficient',
  'specification_review_required',
  'substitution_proposed',
];
const RETRYABLE_BLOCKS = ['roster_exhausted', 'part_unavailable', 'outreach_not_configured', 'suppliers_not_configured'];

/** A business rule refused an event. It is recorded in the history and changes nothing else. */
class Rejection extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContractViolationError('invalid_field', `${field} must be a non-empty string.`);
  }
}

function requireOneOf(value: unknown, allowed: readonly string[], field: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ContractViolationError('invalid_field', `${field} must be one of: ${allowed.join(', ')}.`);
  }
}

function requirePositiveInteger(value: unknown, field: string): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ContractViolationError('invalid_field', `${field} must be a positive integer.`);
  }
}

async function loadRun(job_id: string, context: CoordinationContext): Promise<JobRun> {
  const record = await context.repository.load(job_id);
  if (!record) throw new JobNotFoundError(job_id);
  return new JobRun(record, context);
}

function resolveRequirements(input: Partial<JobRequirements> | undefined): JobRequirements {
  const requirements: JobRequirements = {
    required_qualifications: [...(input?.required_qualifications ?? [])],
    duration_minutes: input?.duration_minutes ?? 120,
    earliest_start_at: input?.earliest_start_at ?? null,
    latest_end_at: input?.latest_end_at ?? null,
  };
  if (!Number.isFinite(requirements.duration_minutes) || requirements.duration_minutes <= 0) {
    throw new ContractViolationError('invalid_field', 'requirements.duration_minutes must be greater than 0.');
  }
  if (requirements.earliest_start_at) parseTime(requirements.earliest_start_at, 'requirements.earliest_start_at');
  if (requirements.latest_end_at) parseTime(requirements.latest_end_at, 'requirements.latest_end_at');
  return requirements;
}

function currentCompletion(record: JobRecord): CompletionEvidence | null {
  return record.completions[record.completions.length - 1] ?? null;
}

function currentAssessment(record: JobRecord): CompletionAssessment | null {
  return record.completion_assessments[record.completion_assessments.length - 1] ?? null;
}

function currentVerification(record: JobRecord) {
  return record.verifications[record.verifications.length - 1] ?? null;
}

function currentOffers(record: JobRecord): TechnicianOffer[] {
  return record.offers.filter((offer) => offer.generation === record.generation);
}

/* ------------------------------------------------------------------ */
/* createRepairJob                                                     */
/* ------------------------------------------------------------------ */

/**
 * Creates the repair job for an approved recommendation.
 *
 * Throws ApprovalError, and creates nothing, unless the recommendation is approved and the
 * approval names its exact version. Without a usable authority the job is created in
 * `awaiting_authorization` and no external action can run. Calling it again for the same
 * recommendation version returns the existing job.
 */
export async function createRepairJob(
  input: CreateRepairJobInput,
  context: CoordinationContext,
): Promise<RepairJob> {
  if (input === null || typeof input !== 'object') {
    throw new ContractViolationError('invalid_input', 'createRepairJob needs { recommendation, authority }.');
  }
  const recommendation = input.recommendation;
  const scope = snapshotScope(recommendation);
  const authority = input.authority ?? null;
  if (authority !== null) assertAuthorityShape(authority);
  const job_id = input.job_id ?? `JOB-${recommendation.recommendation_id}`;
  requireText(job_id, 'job_id');
  const requirements = resolveRequirements(input.requirements);
  const runtime = input.runtime ?? 'job_queue';
  requireOneOf(runtime, ['job_queue', 'band'], 'runtime');
  resolveConfig(context);

  return withJobLock(context.repository, job_id, async () => {
    const existing = await context.repository.load(job_id);
    if (existing) {
      const sameRecommendation =
        existing.approved_scope.recommendation_id === scope.recommendation_id &&
        existing.job.case_id === recommendation.case_id;
      if (
        sameRecommendation &&
        existing.approved_scope.version === scope.version &&
        existing.approved_scope.scope_fingerprint === scope.scope_fingerprint
      ) {
        return clone(existing.job);
      }
      throw new DuplicateJobError(
        'duplicate_job',
        sameRecommendation
          ? `Repair job ${job_id} already exists for recommendation ${scope.recommendation_id} v${existing.approved_scope.version}. Send a recommendation_approved event to move it to v${scope.version}.`
          : `Repair job ${job_id} already exists for another recommendation.`,
      );
    }

    const now = toIso((context.clock ?? systemClock).now());
    const record: JobRecord = {
      record_version: 1,
      runtime,
      verdict_requests: [],
      parts_handoff: null,
      job: {
        schema_version: SCHEMA_VERSION,
        case_id: recommendation.case_id,
        site_id: recommendation.site_id,
        asset_id: recommendation.asset_id,
        job_id,
        recommendation_id: recommendation.recommendation_id,
        recommendation_version: recommendation.version,
        state_version: 0,
        status: 'planning',
        authority: authority ? clone(authority) : null,
        parts_status: recommendation.parts.length === 0 ? 'not_required' : 'not_ordered',
        booking: null,
        actions: [],
        unresolved_findings: recommendation.findings.map((finding) => finding.id),
        closure_review: null,
        updated_at: now,
      },
      approved_scope: scope,
      approval_state: { valid: true, invalid_reason: null, invalidated_at: null },
      requirements,
      sourcing: [],
      generation: 1,
      shortlists: [],
      offers: [],
      excluded_technician_ids: [],
      exceptions: [],
      completions: [],
      completion_assessments: [],
      verifications: [],
      closure_reviews: [],
      ledger: [],
      outcome_evidence: [],
      follow_ups: [],
      escalations: [],
      notified_escalation_ids: [],
      events: [],
      needs_coordination: true,
      counters: { action: 0, event: 0, evidence: 0, follow_up: 0, escalation: 0, offer: 0, verdict: 0 },
    };
    const run = new JobRun(record, context);
    run.emit({
      type: 'job_created',
      summary: `Repair job created from recommendation ${scope.recommendation_id} v${scope.version}, approved by ${scope.approval.reviewer_id} (${scope.approval.mode} approval).`,
      data: {
        recommendation_id: scope.recommendation_id,
        recommendation_version: scope.version,
        scope_fingerprint: scope.scope_fingerprint,
        approval: scope.approval,
        authority_id: authority?.authority_id ?? null,
        runtime,
      },
    });
    const problem = authorityProblem(run);
    if (problem) {
      run.escalate(problem.code, 'authority', 'authority', problem.message);
      run.setStatus('awaiting_authorization', problem.message);
    }
    record.job.state_version = 1;
    await context.repository.insert(record);
    return clone(record.job);
  });
}

function authorityProblem(run: JobRun): ActionRefusal | null {
  const authority = run.job.authority;
  if (!authority) {
    return {
      kind: 'refused',
      code: 'authority_missing',
      message: 'No spending or dispatch authority is configured for this job.',
    };
  }
  if (Date.parse(authority.expires_at) <= run.nowMs()) {
    return {
      kind: 'refused',
      code: 'authority_expired',
      message: `Authority ${authority.authority_id} expired at ${authority.expires_at}.`,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* advanceRepairJob                                                    */
/* ------------------------------------------------------------------ */

function assertEventShape(event: WorkflowEvent): void {
  if (event === null || typeof event !== 'object') {
    throw new ContractViolationError('invalid_event', 'The workflow event must be an object.');
  }
  requireText(event.event_id, 'event.event_id');
  requireOneOf(event.type, WORKFLOW_EVENT_TYPES, 'event.type');
  if (event.occurred_at !== undefined) parseTime(event.occurred_at, 'event.occurred_at');
  if (event.expected_state_version !== undefined) {
    requirePositiveInteger(event.expected_state_version, 'event.expected_state_version');
  }
  switch (event.type) {
    case 'authority_configured':
      assertAuthorityShape(event.authority);
      break;
    case 'recommendation_revised':
    case 'recommendation_approved':
      assertRecommendationShape(event.recommendation);
      break;
    case 'technician_responded':
      requireText(event.technician_id, 'event.technician_id');
      requireOneOf(event.response, ['accepted', 'declined'], 'event.response');
      requireText(event.response_reference, 'event.response_reference');
      requireOneOf(event.mode, INTEGRATION_MODES, 'event.mode');
      break;
    case 'technician_cancelled':
      requireText(event.technician_id, 'event.technician_id');
      requireText(event.reason, 'event.reason');
      break;
    case 'parts_order_updated':
      requireText(event.part_id, 'event.part_id');
      requireOneOf(
        event.order_status,
        ['accepted', 'rejected', 'shipped', 'delivered', 'delayed'],
        'event.order_status',
      );
      if (event.estimated_delivery_at !== undefined) {
        parseTime(event.estimated_delivery_at, 'event.estimated_delivery_at');
      }
      break;
    case 'work_started':
      requireText(event.technician_id, 'event.technician_id');
      break;
    case 'completion_evidence_received': {
      const completion = event.completion;
      if (completion === null || typeof completion !== 'object') {
        throw new ContractViolationError('invalid_field', 'event.completion must be a CompletionEvidence object.');
      }
      requireText(completion.job_id, 'event.completion.job_id');
      requireText(completion.completion_id, 'event.completion.completion_id');
      requireText(completion.asset_id, 'event.completion.asset_id');
      requireText(completion.technician_id, 'event.completion.technician_id');
      requirePositiveInteger(completion.version, 'event.completion.version');
      requireOneOf(completion.reported_status, REPORTED_STATUSES, 'event.completion.reported_status');
      if (!Array.isArray(completion.evidence) || !Array.isArray(completion.unresolved_items)) {
        throw new ContractViolationError(
          'invalid_field',
          'event.completion.evidence and unresolved_items must be arrays.',
        );
      }
      break;
    }
    case 'verification_draft_received': {
      const verification = event.verification;
      if (verification === null || typeof verification !== 'object') {
        throw new ContractViolationError('invalid_field', 'event.verification must be a VerificationDraft object.');
      }
      requireText(verification.job_id, 'event.verification.job_id');
      requireText(verification.verification_id, 'event.verification.verification_id');
      requireText(verification.completion_id, 'event.verification.completion_id');
      requirePositiveInteger(verification.version, 'event.verification.version');
      requirePositiveInteger(verification.completion_version, 'event.verification.completion_version');
      requirePositiveInteger(verification.recommendation_version, 'event.verification.recommendation_version');
      requireOneOf(verification.result, VERIFICATION_RESULTS, 'event.verification.result');
      break;
    }
    case 'closure_review_recorded': {
      const review = event.review;
      if (review === null || typeof review !== 'object') {
        throw new ContractViolationError('invalid_field', 'event.review must be a ClosureReview object.');
      }
      requireText(review.reviewer_id, 'event.review.reviewer_id');
      requireText(review.verification_id, 'event.review.verification_id');
      requirePositiveInteger(review.verification_version, 'event.review.verification_version');
      requirePositiveInteger(review.completion_version, 'event.review.completion_version');
      requirePositiveInteger(review.recommendation_version, 'event.review.recommendation_version');
      requireOneOf(review.decision, CLOSURE_DECISIONS, 'event.review.decision');
      requireOneOf(review.mode, INTEGRATION_MODES, 'event.review.mode');
      parseTime(review.reviewed_at, 'event.review.reviewed_at');
      break;
    }
    case 'exception_approved':
      requireOneOf(event.exception, ['schedule_before_parts'], 'event.exception');
      requireText(event.approved_by, 'event.approved_by');
      requireText(event.reason, 'event.reason');
      break;
    case 'job_cancelled':
      requireText(event.cancelled_by, 'event.cancelled_by');
      requireText(event.reason, 'event.reason');
      break;
    case 'action_verdict_recorded':
      requireText(event.request_id, 'event.request_id');
      requireOneOf(event.verdict, ['approved', 'blocked'], 'event.verdict');
      requireText(event.decided_by, 'event.decided_by');
      requireText(event.reason, 'event.reason');
      requireText(event.reference, 'event.reference');
      break;
  }
}

/** A changed authority or approval makes earlier verdicts stale; they are asked for again. */
function supersedeVerdicts(record: JobRecord): void {
  for (const request of record.verdict_requests ?? []) {
    if (request.status === 'pending' || request.status === 'blocked') request.status = 'superseded';
  }
}

/**
 * Applies one typed workflow event and persists the job. It calls no external adapter; work
 * an event leaves behind is done by coordinateRepair.
 *
 * Re-sending an event id returns the stored outcome. An event a business rule refuses is
 * written to the history as rejected, leaves the job unchanged and raises EventRejectedError.
 */
export async function advanceRepairJob(
  job_id: string,
  event: WorkflowEvent,
  context: CoordinationContext,
): Promise<RepairJob> {
  requireText(job_id, 'job_id');
  assertEventShape(event);
  return withJobLock(context.repository, job_id, async () => {
    const original = await context.repository.load(job_id);
    if (!original) throw new JobNotFoundError(job_id);
    const payload = fingerprint(event);
    const previous = original.events.find(
      (item) => item.kind === 'workflow_event' && item.source_event_id === event.event_id,
    );
    if (previous) {
      if (previous.payload_fingerprint !== payload) {
        throw new CoordinationError(
          'event_id_conflict',
          `Event id "${event.event_id}" was already recorded for job ${job_id} with a different payload.`,
        );
      }
      if (previous.outcome === 'rejected') {
        throw new EventRejectedError(
          job_id,
          event.event_id,
          previous.rejection?.code ?? 'rejected',
          previous.rejection?.message ?? previous.summary,
        );
      }
      return clone(original.job);
    }

    const run = new JobRun(clone(original), context);
    const entry = run.emit({
      kind: 'workflow_event',
      type: event.type,
      summary: event.type,
      occurred_at: event.occurred_at,
      source_event_id: event.event_id,
      payload_fingerprint: payload,
      data: event,
    });
    try {
      if (event.expected_state_version !== undefined && event.expected_state_version !== original.job.state_version) {
        throw new Rejection(
          'stale_state',
          `The event was raised against state_version ${event.expected_state_version}; the job is at ${original.job.state_version}.`,
        );
      }
      entry.summary = applyEvent(run, event);
      entry.status_after = run.job.status;
    } catch (error) {
      const rejection =
        error instanceof Rejection
          ? error
          : error instanceof ApprovalError
            ? new Rejection(error.code, error.message)
            : null;
      if (!rejection) throw error;
      const rejected = new JobRun(clone(original), context);
      rejected.emit({
        kind: 'workflow_event',
        type: event.type,
        summary: `Rejected ${event.type}: ${rejection.message}`,
        occurred_at: event.occurred_at,
        outcome: 'rejected',
        rejection: { code: rejection.code, message: rejection.message },
        source_event_id: event.event_id,
        payload_fingerprint: payload,
        data: event,
      });
      await rejected.persist();
      throw new EventRejectedError(job_id, event.event_id, rejection.code, rejection.message);
    }
    run.job.parts_status = computePartsStatus(run.record);
    await run.persist();
    return clone(run.job);
  });
}

function assertSameIdentity(
  job: RepairJob,
  subject: { case_id: string; site_id: string; asset_id?: string },
  what: string,
  includeAsset: boolean,
): void {
  if (subject.case_id !== job.case_id || subject.site_id !== job.site_id) {
    throw new Rejection(
      'identity_mismatch',
      `${what} is for case ${subject.case_id} at site ${subject.site_id}; the job is for case ${job.case_id} at site ${job.site_id}.`,
    );
  }
  if (includeAsset && subject.asset_id !== job.asset_id) {
    throw new Rejection(
      'identity_mismatch',
      `${what} is for asset ${subject.asset_id}; the job is for asset ${job.asset_id}.`,
    );
  }
}

function assertOpen(job: RepairJob): void {
  if (job.status === 'closed' || job.status === 'cancelled') {
    throw new Rejection('job_not_open', `The job is ${job.status} and accepts no further events.`);
  }
}

function applyEvent(run: JobRun, event: WorkflowEvent): string {
  const { record, job } = run;
  assertOpen(job);
  const occurredAt = event.occurred_at ?? run.nowIso();

  switch (event.type) {
    case 'authority_configured': {
      job.authority = clone(event.authority);
      supersedeVerdicts(record);
      run.resolveEscalations((item) => AUTHORITY_CODES.includes(item.code), 'A new authority was configured.');
      if (job.status === 'awaiting_authorization' && record.approval_state.valid) {
        run.setStatus('planning', `Authority ${event.authority.authority_id} was configured.`);
      }
      record.needs_coordination = true;
      return `Authority ${event.authority.authority_id} configured (${event.authority.mode}, limit ${formatMoney(event.authority.max_total_minor, event.authority.currency)}, expires ${event.authority.expires_at}).`;
    }

    case 'recommendation_revised': {
      const revised = event.recommendation;
      if (revised.recommendation_id !== job.recommendation_id) {
        throw new Rejection('identity_mismatch', `Recommendation ${revised.recommendation_id} is not the one this job was created from.`);
      }
      assertSameIdentity(job, revised, 'The recommendation', true);
      return invalidateIfChanged(run, revised) ?? 'The recommendation matches the approved scope. Nothing changed.';
    }

    case 'recommendation_approved': {
      const approved = event.recommendation;
      if (approved.recommendation_id !== job.recommendation_id) {
        throw new Rejection('identity_mismatch', `Recommendation ${approved.recommendation_id} is not the one this job was created from.`);
      }
      assertSameIdentity(job, approved, 'The recommendation', true);
      const scope = snapshotScope(approved);
      const current = record.approved_scope;
      if (scope.version < current.version) {
        throw new Rejection('stale_recommendation', `Version ${scope.version} is older than the approved version ${current.version}.`);
      }
      const changed = scope.scope_fingerprint !== current.scope_fingerprint;
      if (scope.version === current.version && changed) {
        throw new Rejection(
          'approval_version_reused',
          `The scope or parts changed but the version is still ${scope.version}. A changed recommendation needs a new version and a new approval.`,
        );
      }
      if (scope.version === current.version && record.approval_state.valid) {
        return `Version ${scope.version} is already approved. Nothing changed.`;
      }
      for (const entry of activeSourcing(record)) {
        const part = scope.parts.find((item) => item.part_id === entry.part_id);
        const unchanged =
          part !== undefined &&
          !part.requires_specification_review &&
          normaliseSpecification(part.approved_specification) === normaliseSpecification(entry.approved_specification) &&
          part.quantity === entry.quantity &&
          part.unit === entry.unit;
        if (unchanged) {
          entry.recommendation_version = scope.version;
          continue;
        }
        entry.status = 'superseded';
        entry.status_detail = `Superseded by recommendation v${scope.version}.`;
        const order = entry.order;
        if (order && order.purchase_outcome !== 'failed' && order.purchase_outcome !== 'rejected') {
          run.escalate(
            'superseded_order',
            'manager',
            entry.part_id,
            `An order for ${entry.part_id} (${order.supplier_name}, reference ${order.provider_reference ?? 'none'}) was placed under v${current.version}. The new approval changes or removes this part. The order was not cancelled automatically.`,
          );
        }
      }
      record.approved_scope = scope;
      supersedeVerdicts(record);
      record.approval_state = { valid: true, invalid_reason: null, invalidated_at: null };
      job.recommendation_version = scope.version;
      job.unresolved_findings = scope.findings.map((finding) => finding.id);
      run.resolveEscalations((item) => APPROVAL_CODES.includes(item.code), `Recommendation v${scope.version} was approved.`);
      if (PLANNING_STATUSES.includes(job.status)) {
        run.setStatus('planning', `Recommendation v${scope.version} approved by ${scope.approval.reviewer_id}.`);
      }
      record.needs_coordination = true;
      return `Recommendation v${scope.version} approved by ${scope.approval.reviewer_id} (${scope.approval.mode} approval).`;
    }

    case 'technician_responded': {
      const offer = [...currentOffers(record)]
        .reverse()
        .find(
          (item) =>
            item.technician_id === event.technician_id &&
            (item.status === 'awaiting_response' || item.status === 'no_response'),
        );
      if (!offer) {
        throw new Rejection('no_open_offer', `Technician ${event.technician_id} has no open offer in booking round ${record.generation}.`);
      }
      run.closeFollowUps(
        (item) => item.kind === 'technician_response' && item.subject === offer.offer_id,
        'done',
        `Technician ${event.response}.`,
      );
      if (event.response === 'declined') {
        offer.status = 'declined';
        offer.closed_reason = event.response_text ?? 'Declined.';
        if (job.booking?.technician_id === offer.technician_id && job.booking.status === 'proposed') {
          job.booking = null;
        }
        record.needs_coordination = true;
        return `${offer.technician_name} declined the offer for ${offer.start_at}.`;
      }
      const taken = currentOffers(record).find(
        (item) => item !== offer && (item.status === 'accepted' || item.status === 'confirmed'),
      );
      if (taken) {
        offer.status = 'superseded';
        offer.closed_reason = `Replied after ${taken.technician_name} had accepted.`;
        return `${offer.technician_name} accepted late. ${taken.technician_name} already holds the appointment.`;
      }
      const evidence = run.addEvidence(
        'technician_response',
        event.mode,
        {
          technician_id: event.technician_id,
          response: event.response,
          response_reference: event.response_reference,
          response_text: event.response_text ?? null,
          reported_by: event.reported_by ?? null,
          occurred_at: occurredAt,
          offered_start_at: offer.start_at,
          offered_end_at: offer.end_at,
        },
        null,
      );
      offer.status = 'accepted';
      offer.acceptance_evidence_id = evidence.evidence_id;
      offer.acceptance_reference = event.response_reference;
      offer.acceptance_mode = event.mode;
      job.booking = {
        technician_id: offer.technician_id,
        technician_name: offer.technician_name,
        start_at: offer.start_at,
        end_at: offer.end_at,
        status: 'proposed',
        confirmation_action_id: null,
      };
      reconcileBooking(run);
      record.needs_coordination = true;
      return `${offer.technician_name} accepted ${offer.start_at} to ${offer.end_at} (reply ${event.response_reference}).`;
    }

    case 'technician_cancelled': {
      const booking = job.booking;
      if (!booking || booking.technician_id !== event.technician_id || booking.status === 'cancelled') {
        throw new Rejection('no_active_booking', `Technician ${event.technician_id} holds no active booking for this job.`);
      }
      if (!['coordinating', 'scheduled', 'in_progress'].includes(job.status)) {
        throw new Rejection('invalid_status', `A booking cannot be cancelled while the job is ${job.status}.`);
      }
      cancelRound(run, {
        reason: `${booking.technician_name} cancelled: ${event.reason}`,
        exclude_technician: true,
        evidence: {
          technician_id: event.technician_id,
          reason: event.reason,
          cancellation_reference: event.cancellation_reference ?? null,
          occurred_at: occurredAt,
        },
      });
      return `${booking.technician_name} cancelled the ${booking.start_at} appointment: ${event.reason}. Replanning without a new parts order.`;
    }

    case 'parts_order_updated':
      return applyPartsUpdate(run, event, occurredAt);

    case 'work_started': {
      if (job.status !== 'scheduled' || job.booking?.status !== 'confirmed') {
        throw new Rejection('invalid_status', `Work can start only on a scheduled job; the job is ${job.status}.`);
      }
      if (job.booking.technician_id !== event.technician_id) {
        throw new Rejection('technician_mismatch', `The booked technician is ${job.booking.technician_id}, not ${event.technician_id}.`);
      }
      run.setStatus('in_progress', `${job.booking.technician_name} started work.`);
      return `${job.booking.technician_name} started work.`;
    }

    case 'completion_evidence_received':
      return applyCompletion(run, event.completion);

    case 'verification_draft_received': {
      const verification = event.verification;
      if (verification.job_id !== job.job_id) {
        throw new Rejection('job_mismatch', `The verification draft is for job ${verification.job_id}.`);
      }
      assertSameIdentity(job, verification, 'The verification draft', true);
      const completion = currentCompletion(record);
      if (!completion) {
        throw new Rejection('nothing_to_verify', 'No completion evidence has been recorded for this job.');
      }
      if (verification.recommendation_version !== job.recommendation_version) {
        throw new Rejection(
          'stale_verification',
          `The draft compares against recommendation v${verification.recommendation_version}; the job is at v${job.recommendation_version}.`,
        );
      }
      if (verification.completion_id !== completion.completion_id || verification.completion_version !== completion.version) {
        throw new Rejection(
          'stale_verification',
          `The draft covers completion ${verification.completion_id} v${verification.completion_version}; the current one is ${completion.completion_id} v${completion.version}.`,
        );
      }
      const same = record.verifications.find(
        (item) => item.verification_id === verification.verification_id && item.version === verification.version,
      );
      if (same) {
        if (fingerprint(same) === fingerprint(verification)) return 'This verification draft is already recorded.';
        throw new Rejection('verification_version_conflict', 'A changed verification draft needs a new version.');
      }
      record.verifications.push(clone(verification));
      run.closeFollowUps((item) => item.kind === 'verification_pending', 'done', 'Verification draft received.');
      const subject = `${verification.verification_id}:v${verification.version}`;
      if (verification.result === 'ready_for_review') {
        run.scheduleFollowUp(
          'verification_pending',
          `review:${subject}`,
          addMinutes(run.nowIso(), run.config.verification_reminder_minutes),
        );
      } else {
        const missing = verification.missing_information.length
          ? ` Missing: ${verification.missing_information.join('; ')}.`
          : '';
        run.escalate(
          `verification_${verification.result}`,
          'manager',
          subject,
          `Verification draft ${subject} says ${verification.result}. The job stays open.${missing}`,
        );
        run.scheduleFollowUp(
          'completion_evidence',
          `g${record.generation}`,
          addMinutes(run.nowIso(), run.config.completion_grace_minutes),
        );
      }
      record.needs_coordination = true;
      return `Verification draft ${subject} recorded: ${verification.result} (${verification.analysis_mode} analysis).`;
    }

    case 'closure_review_recorded': {
      const review = event.review;
      const completion = currentCompletion(record);
      const verification = currentVerification(record);
      const assessment = currentAssessment(record);
      if (!completion || !verification || !assessment) {
        throw new Rejection('nothing_to_review', 'Closure needs recorded completion evidence and a verification draft.');
      }
      if (job.status !== 'awaiting_verification') {
        throw new Rejection('invalid_status', `A closure review is accepted while the job awaits verification; it is ${job.status}.`);
      }
      const bound =
        review.verification_id === verification.verification_id &&
        review.verification_version === verification.version &&
        review.completion_version === completion.version &&
        review.recommendation_version === job.recommendation_version &&
        verification.completion_id === completion.completion_id &&
        verification.completion_version === completion.version;
      if (!bound) {
        throw new Rejection(
          'stale_review',
          `The review is bound to verification ${review.verification_id} v${review.verification_version}, completion v${review.completion_version} and recommendation v${review.recommendation_version}. Current: verification ${verification.verification_id} v${verification.version}, completion v${completion.version}, recommendation v${job.recommendation_version}.`,
        );
      }
      if (!modeCovers(review.mode, record.approved_scope.approval.mode)) {
        throw new Rejection(
          'review_mode_insufficient',
          `A ${review.mode} review cannot close a job approved in ${record.approved_scope.approval.mode} mode.`,
        );
      }
      if (review.decision === 'approve_closure') {
        if (!assessment.acceptable_for_closure) {
          throw new Rejection('closure_not_permitted', `The completion evidence does not support closure: ${assessment.issues.join(' ')}`);
        }
        if (verification.result !== 'ready_for_review') {
          throw new Rejection('closure_not_permitted', `The verification draft says ${verification.result}, so the job stays open.`);
        }
      }
      record.closure_reviews.push(clone(review));
      job.closure_review = clone(review);
      run.closeFollowUps((item) => item.kind === 'verification_pending', 'done', 'Closure review recorded.');
      record.needs_coordination = true;
      if (review.decision === 'keep_open') {
        run.setStatus('in_progress', `Reviewer ${review.reviewer_id} kept the job open.`);
        run.escalate(
          'closure_kept_open',
          'manager',
          `${verification.verification_id}:v${verification.version}`,
          `Reviewer ${review.reviewer_id} kept the job open. New completion evidence is needed.`,
        );
        run.scheduleFollowUp(
          'completion_evidence',
          `g${record.generation}`,
          addMinutes(run.nowIso(), run.config.completion_grace_minutes),
        );
        return `Reviewer ${review.reviewer_id} kept the job open (${review.mode} review).`;
      }
      job.unresolved_findings = [];
      run.setStatus('closed', `Closure approved by ${review.reviewer_id} (${review.mode} review).`);
      run.closeFollowUps(() => true, 'cancelled', 'The job is closed.');
      run.resolveEscalations(() => true, 'The job was closed after an accepted verification.');
      return `Reviewer ${review.reviewer_id} approved closure (${review.mode} review) against verification ${verification.verification_id} v${verification.version}.`;
    }

    case 'exception_approved': {
      record.exceptions.push({
        exception: event.exception,
        approved_by: event.approved_by,
        reason: event.reason,
        approved_at: occurredAt,
        source_event_id: event.event_id,
      });
      reconcileBooking(run);
      record.needs_coordination = true;
      return `${event.approved_by} approved booking before parts are confirmed: ${event.reason}`;
    }

    case 'action_verdict_recorded': {
      const request = (record.verdict_requests ?? []).find((item) => item.request_id === event.request_id);
      if (!request) {
        throw new Rejection('unknown_verdict_request', `No verdict request ${event.request_id} exists for this job.`);
      }
      if (request.status !== 'pending') {
        throw new Rejection('verdict_already_recorded', `Verdict request ${event.request_id} is already ${request.status}.`);
      }
      request.status = event.verdict;
      request.decided_at = occurredAt;
      request.decided_by = event.decided_by;
      request.reason = event.reason;
      request.reference = event.reference;
      record.needs_coordination = true;
      if (event.verdict === 'blocked') {
        run.escalate(
          'verdict_blocked',
          'authority',
          request.logical_key,
          `${event.decided_by} blocked "${request.summary}": ${event.reason.replace(/\.+$/, '')}. It was not executed.`,
        );
        if (PLANNING_STATUSES.includes(job.status)) {
          run.setStatus('awaiting_authorization', `${event.decided_by} blocked ${request.action_type}.`);
        }
      } else {
        reconcileBooking(run);
      }
      return `${event.decided_by} ${event.verdict} ${request.request_id} (${request.action_type}): ${event.reason}`;
    }

    case 'job_cancelled': {
      if (job.booking && job.booking.status !== 'cancelled') {
        cancelRound(run, {
          reason: `Job cancelled by ${event.cancelled_by}: ${event.reason}`,
          exclude_technician: false,
          evidence: { cancelled_by: event.cancelled_by, reason: event.reason, occurred_at: occurredAt },
        });
      }
      for (const entry of record.sourcing) {
        const order = entry.order;
        if (order && order.purchase_outcome !== 'failed' && order.purchase_outcome !== 'rejected' && entry.status !== 'superseded') {
          run.escalate(
            'order_outstanding_after_cancellation',
            'manager',
            entry.part_id,
            `The order for ${entry.part_id} (${order.supplier_name}, reference ${order.provider_reference ?? 'none'}) was not cancelled automatically.`,
          );
        }
      }
      run.closeFollowUps(() => true, 'cancelled', 'The job was cancelled.');
      run.setStatus('cancelled', `Cancelled by ${event.cancelled_by}: ${event.reason}`);
      record.needs_coordination = true;
      return `Job cancelled by ${event.cancelled_by}: ${event.reason}`;
    }
  }
}

/** Invalidates the approval when the recommendation differs from what was approved. */
function invalidateIfChanged(run: JobRun, recommendation: Recommendation): string | null {
  const { record, job } = run;
  const current = record.approved_scope;
  const sameVersion = recommendation.version === current.version;
  const sameScope = scopeFingerprint(recommendation) === current.scope_fingerprint;
  if (sameVersion && sameScope) return null;
  const reason = sameVersion
    ? `The scope or parts changed while the version stayed ${current.version}.`
    : sameScope
      ? `The recommendation moved from v${current.version} to v${recommendation.version}.`
      : `The recommendation moved from v${current.version} to v${recommendation.version} with a changed scope or parts.`;
  record.approval_state = { valid: false, invalid_reason: reason, invalidated_at: run.nowIso() };
  run.escalate(
    'reapproval_required',
    'reviewer',
    'approval',
    `${reason} The earlier approval does not cover it. No purchase, outreach or booking runs until a new approval is recorded.`,
  );
  if (['planning', 'coordinating', 'scheduled', 'blocked'].includes(job.status)) {
    run.setStatus('awaiting_authorization', reason);
  }
  record.needs_coordination = true;
  return `${reason} A new approval is required.`;
}

interface CancelRoundInput {
  reason: string;
  exclude_technician: boolean;
  evidence: unknown;
}

/** Ends the current booking round. Orders are untouched, so replanning cannot re-order. */
function cancelRound(run: JobRun, input: CancelRoundInput): void {
  const { record, job } = run;
  const booking = job.booking;
  let mode: IntegrationMode = job.authority?.mode ?? 'simulated';
  for (const offer of currentOffers(record)) {
    if (!['awaiting_response', 'accepted', 'confirmed'].includes(offer.status)) continue;
    mode = offer.acceptance_mode ?? mode;
    offer.status = 'cancelled';
    offer.closed_reason = input.reason;
  }
  run.addEvidence('cancellation', mode, input.evidence, booking?.confirmation_action_id ?? null);
  if (booking) {
    booking.status = 'cancelled';
    if (input.exclude_technician && !record.excluded_technician_ids.includes(booking.technician_id)) {
      record.excluded_technician_ids.push(booking.technician_id);
    }
  }
  run.closeFollowUps(
    (item) => item.kind === 'completion_evidence' || item.kind === 'technician_response',
    'cancelled',
    input.reason,
  );
  run.emit({
    type: 'booking_round_cancelled',
    summary: `Booking round ${record.generation} ended: ${input.reason}`,
    data: { generation: record.generation, technician_id: booking?.technician_id ?? null },
  });
  record.generation += 1;
  if (['scheduled', 'in_progress', 'blocked'].includes(job.status)) {
    run.setStatus('coordinating', input.reason);
  }
  record.needs_coordination = true;
}

/**
 * Confirms the accepted appointment once authority, approval and the parts situation allow
 * it. The technician's reply is the evidence of the booking.
 */
function reconcileBooking(run: JobRun): void {
  const { record, job } = run;
  const offer = currentOffers(record).find((item) => item.status === 'accepted');
  if (!offer || !offer.acceptance_mode || !offer.acceptance_evidence_id) return;
  if (!PLANNING_STATUSES.includes(job.status)) return;

  const refusal = checkActionAllowed(run, 'booking', offer.acceptance_mode, true);
  if (refusal) {
    run.escalate(refusal.code, refusal.code.startsWith('approval') ? 'reviewer' : 'authority', 'booking', refusal.message);
    run.setStatus('awaiting_authorization', refusal.message);
    return;
  }
  const parts = partsSupportAppointment(record, offer.start_at, run.config);
  if (!parts.supported) {
    const already = record.events.some(
      (item) => item.type === 'booking_held' && (item.data as { key?: string } | null)?.key === `${offer.offer_id}:${parts.reason}`,
    );
    if (!already) {
      run.emit({
        type: 'booking_held',
        summary: `${offer.technician_name} accepted, but the appointment is not confirmed yet: ${parts.reason}`,
        data: { key: `${offer.offer_id}:${parts.reason}`, offer_id: offer.offer_id },
      });
    }
    return;
  }

  const logical_key = `booking:${offer.technician_id}:g${offer.generation}`;
  if (run.requiresVerdicts) {
    const verdict = run.verdictFor(
      logical_key,
      'booking',
      `Confirm the booking with ${offer.technician_name} for ${offer.start_at}`,
      {
        technician_id: offer.technician_id,
        technician_name: offer.technician_name,
        start_at: offer.start_at,
        end_at: offer.end_at,
        generation: offer.generation,
        mode: offer.acceptance_mode,
        acceptance_reference: offer.acceptance_reference,
      },
    );
    if (verdict.status === 'pending') return;
    if (verdict.status === 'blocked') {
      run.setStatus('awaiting_authorization', `The critic blocked the booking: ${verdict.reason ?? 'no reason given'}`);
      return;
    }
  }
  let entry = record.ledger.find((item) => item.logical_key === logical_key);
  if (!entry) {
    const action_id = run.nextActionId();
    const now = run.nowIso();
    entry = {
      idempotency_key: `${job.job_id}:${logical_key}:a1`,
      logical_key,
      attempt: 1,
      action_id,
      action_type: 'booking',
      state: 'recorded',
      requested_at: now,
      recorded_at: now,
      status: 'confirmed',
      data: null,
    };
    record.ledger.push(entry);
    job.actions.push({
      action_id,
      job_id: job.job_id,
      action_type: 'booking',
      idempotency_key: entry.idempotency_key,
      mode: offer.acceptance_mode,
      status: 'confirmed',
      provider_reference: offer.acceptance_reference,
      evidence_ids: [offer.acceptance_evidence_id],
      detail: labelDetail(
        offer.acceptance_mode,
        `${offer.technician_name} accepted ${offer.start_at} to ${offer.end_at} (reply ${offer.acceptance_reference}). ${parts.reason}`,
      ),
      recorded_at: now,
    });
    run.emit({
      type: 'action_recorded',
      summary: `Booking confirmed with ${offer.technician_name} for ${offer.start_at}: confirmed`,
      action_id,
      mode: offer.acceptance_mode,
      data: { action_type: 'booking', status: 'confirmed', evidence_ids: [offer.acceptance_evidence_id] },
    });
  }
  offer.status = 'confirmed';
  offer.booking_action_id = entry.action_id;
  job.booking = {
    technician_id: offer.technician_id,
    technician_name: offer.technician_name,
    start_at: offer.start_at,
    end_at: offer.end_at,
    status: 'confirmed',
    confirmation_action_id: entry.action_id,
  };
  run.setStatus('scheduled', 'The technician and appointment are confirmed and the parts situation supports the plan.');
  run.resolveEscalations((item) => RETRYABLE_BLOCKS.includes(item.code), 'A booking was confirmed.');
  run.scheduleFollowUp(
    'completion_evidence',
    `g${offer.generation}`,
    addMinutes(offer.end_at, run.config.completion_grace_minutes),
  );
  record.needs_coordination = true;
}

function applyPartsUpdate(
  run: JobRun,
  event: Extract<WorkflowEvent, { type: 'parts_order_updated' }>,
  occurredAt: string,
): string {
  const { record, job } = run;
  const entry = activeSourcing(record).find((item) => item.part_id === event.part_id);
  const order = entry?.order;
  if (!entry || !order) {
    throw new Rejection('no_matching_order', `No order is recorded for part ${event.part_id}.`);
  }
  if (event.order_status === 'delayed' && !event.estimated_delivery_at) {
    throw new Rejection('delivery_estimate_required', 'A delay must carry the new estimated_delivery_at.');
  }
  const receipt = run.receipt(order.action_id);
  const evidence = run.addEvidence('provider_response', order.mode, event, order.action_id);
  receipt.evidence_ids.push(evidence.evidence_id);
  receipt.recorded_at = run.nowIso();
  if (event.provider_reference) {
    order.provider_reference = event.provider_reference;
    receipt.provider_reference = event.provider_reference;
  }
  if (event.estimated_delivery_at) order.estimated_delivery_at = event.estimated_delivery_at;
  const note = event.detail ? ` ${event.detail}` : '';
  record.needs_coordination = true;
  let summary: string;

  switch (event.order_status) {
    case 'accepted':
      order.purchase_outcome = 'confirmed';
      receipt.status = 'confirmed';
      receipt.detail = labelDetail(order.mode, `${order.supplier_name} accepted the order for ${entry.part_id}.${note}`);
      entry.status_detail = `Ordered from ${order.supplier_name}; accepted by the supplier.`;
      summary = `${order.supplier_name} accepted the order for ${entry.part_id}.`;
      break;
    case 'rejected':
      order.purchase_outcome = 'rejected';
      receipt.status = 'failed';
      receipt.detail = labelDetail(order.mode, `${order.supplier_name} rejected the order for ${entry.part_id}.${note}`);
      entry.excluded_supplier_ids.push(order.supplier_id);
      entry.order = null;
      entry.status = 'pending';
      entry.status_detail = `${order.supplier_name} rejected the order; sourcing from the remaining allowed suppliers.`;
      run.closeFollowUps((item) => item.kind === 'parts_delivery' && item.subject === entry.part_id, 'cancelled', 'Order rejected.');
      summary = `${order.supplier_name} rejected the order for ${entry.part_id}. Sourcing again.`;
      break;
    case 'shipped':
      entry.status_detail = `Shipped by ${order.supplier_name}; estimated ${order.estimated_delivery_at ?? 'unknown'}.`;
      summary = `${order.supplier_name} shipped ${entry.part_id}; estimated ${order.estimated_delivery_at ?? 'unknown'}.`;
      break;
    case 'delivered':
      order.purchase_outcome = 'confirmed';
      order.delivered_at = occurredAt;
      receipt.status = 'confirmed';
      receipt.detail = labelDetail(order.mode, `${entry.part_id} delivered by ${order.supplier_name} at ${occurredAt}.${note}`);
      entry.status = 'delivered';
      entry.status_detail = `Delivered at ${occurredAt}.`;
      run.closeFollowUps((item) => item.kind === 'parts_delivery' && item.subject === entry.part_id, 'done', 'Delivered.');
      run.resolveEscalations(
        (item) => (item.code === 'parts_delayed' || item.code === 'parts_late') && item.subject === entry.part_id,
        'The part was delivered.',
      );
      summary = `${entry.part_id} delivered by ${order.supplier_name}.`;
      break;
    case 'delayed': {
      const estimate = event.estimated_delivery_at!;
      entry.status = 'delayed';
      entry.status_detail = `Delayed by ${order.supplier_name}; new estimate ${estimate}.`;
      run.closeFollowUps((item) => item.kind === 'parts_delivery' && item.subject === entry.part_id, 'cancelled', 'Delivery estimate changed.');
      run.scheduleFollowUp('parts_delivery', entry.part_id, estimate);
      const booking = job.booking;
      const conflicts =
        booking !== null &&
        booking.status !== 'cancelled' &&
        ['coordinating', 'scheduled'].includes(job.status) &&
        !partsSupportAppointment(record, booking.start_at, run.config).supported;
      if (conflicts && booking) {
        run.escalate(
          'parts_delay_conflicts_with_booking',
          'manager',
          entry.part_id,
          `${entry.part_id} is now estimated for ${estimate}, too late for the ${booking.start_at} appointment with ${booking.technician_name}. The appointment is being replanned.`,
        );
        cancelRound(run, {
          reason: `${entry.part_id} delayed to ${estimate}`,
          exclude_technician: false,
          evidence: { part_id: entry.part_id, estimated_delivery_at: estimate, occurred_at: occurredAt },
        });
      } else {
        run.escalate(
          'parts_delayed',
          'manager',
          entry.part_id,
          `${entry.part_id} is delayed to ${estimate}. No confirmed appointment is affected.`,
        );
      }
      summary = `${order.supplier_name} delayed ${entry.part_id} to ${estimate}.`;
      break;
    }
  }
  job.parts_status = computePartsStatus(record);
  reconcileBooking(run);
  return summary;
}

function assessCompletion(job: RepairJob, completion: CompletionEvidence): CompletionAssessment {
  const mismatched = completion.evidence
    .filter((item) => item.asset_id !== null && item.asset_id !== job.asset_id)
    .map((item) => item.id);
  const issues: string[] = [];
  if (completion.asset_id !== job.asset_id) {
    issues.push(`The completion is for asset ${completion.asset_id}; the job is for ${job.asset_id}.`);
  }
  if (mismatched.length > 0) {
    issues.push(`Evidence ${mismatched.join(', ')} names another asset than ${job.asset_id}.`);
  }
  if (completion.reported_status !== 'complete') {
    issues.push(`The technician reported the work as ${completion.reported_status}.`);
  }
  if (completion.evidence.length === 0) issues.push('No completion evidence was supplied.');
  for (const item of completion.unresolved_items) issues.push(`Unresolved: ${item}`);
  return {
    completion_id: completion.completion_id,
    version: completion.version,
    asset_mismatch_evidence_ids: mismatched,
    issues,
    acceptable_for_closure: issues.length === 0,
  };
}

function applyCompletion(run: JobRun, completion: CompletionEvidence): string {
  const { record, job } = run;
  if (completion.job_id !== job.job_id) {
    throw new Rejection('job_mismatch', `The completion evidence is for job ${completion.job_id}.`);
  }
  assertSameIdentity(job, completion, 'The completion evidence', false);
  if (!['scheduled', 'in_progress', 'awaiting_verification'].includes(job.status)) {
    throw new Rejection('invalid_status', `Completion evidence is accepted once a technician is booked; the job is ${job.status}.`);
  }
  const same = record.completions.find(
    (item) => item.completion_id === completion.completion_id && item.version === completion.version,
  );
  if (same) {
    if (fingerprint(same) === fingerprint(completion)) return 'This completion evidence is already recorded.';
    throw new Rejection('completion_version_conflict', 'Changed completion evidence needs a new version.');
  }
  const latest = currentCompletion(record);
  if (latest && latest.completion_id === completion.completion_id && completion.version < latest.version) {
    throw new Rejection('stale_completion', `Version ${completion.version} is older than the recorded version ${latest.version}.`);
  }

  // Stored exactly as received. A wrong asset id is kept and flagged, never rewritten.
  record.completions.push(clone(completion));
  const assessment = assessCompletion(job, completion);
  record.completion_assessments.push(assessment);
  const subject = `${completion.completion_id}:v${completion.version}`;
  run.closeFollowUps(
    (item) => item.kind === 'completion_evidence' || item.kind === 'verification_pending',
    'done',
    `Completion evidence ${subject} received.`,
  );
  run.resolveEscalations(
    (item) => ['completion_evidence_missing', 'closure_kept_open'].includes(item.code),
    `Completion evidence ${subject} received.`,
  );
  record.needs_coordination = true;

  if (assessment.asset_mismatch_evidence_ids.length > 0 || completion.asset_id !== job.asset_id) {
    run.escalate(
      'completion_asset_mismatch',
      'manager',
      subject,
      `Completion evidence ${subject} does not match asset ${job.asset_id}. ${assessment.issues[0]} The job stays open.`,
    );
  }
  if (completion.reported_status === 'complete') {
    run.setStatus('awaiting_verification', `Completion evidence ${subject} received.`);
    run.scheduleFollowUp(
      'verification_pending',
      subject,
      addMinutes(run.nowIso(), run.config.verification_reminder_minutes),
    );
  } else {
    run.setStatus('in_progress', `The technician reported the work as ${completion.reported_status}.`);
    run.escalate(
      'completion_incomplete',
      'manager',
      subject,
      `Technician ${completion.technician_id} reported the work as ${completion.reported_status}: ${completion.comments}`,
    );
    run.scheduleFollowUp(
      'completion_evidence',
      `g${record.generation}`,
      addMinutes(run.nowIso(), run.config.completion_grace_minutes),
    );
  }
  return assessment.acceptable_for_closure
    ? `Completion evidence ${subject} recorded (${completion.reported_status}).`
    : `Completion evidence ${subject} recorded (${completion.reported_status}) with issues: ${assessment.issues.join(' ')}`;
}

/* ------------------------------------------------------------------ */
/* coordinateRepair                                                    */
/* ------------------------------------------------------------------ */

function assertAdapters(adapters: CoordinationAdapters): void {
  if (adapters === null || typeof adapters !== 'object' || !Array.isArray(adapters.suppliers)) {
    throw new ContractViolationError(
      'invalid_adapters',
      'coordinateRepair needs { suppliers, roster, communication, schedule, manager }. Pass null for an absent adapter.',
    );
  }
  const ids = new Set<string>();
  for (const supplier of adapters.suppliers) {
    requireText(supplier.supplier_id, 'adapters.suppliers[].supplier_id');
    requireOneOf(supplier.mode, INTEGRATION_MODES, `adapters.suppliers[${supplier.supplier_id}].mode`);
    if (ids.has(supplier.supplier_id)) {
      throw new ContractViolationError('duplicate_supplier', `Supplier ${supplier.supplier_id} is listed twice.`);
    }
    ids.add(supplier.supplier_id);
  }
}

/**
 * Makes as much progress as the current state allows: sources the approved parts, contacts
 * the technician shortlist, confirms the appointment, calls the schedule adapter and informs
 * the manager. It is safe to call again at any time; known outcomes are never repeated.
 */
export async function coordinateRepair(
  job_id: string,
  adapters: CoordinationAdapters,
  context: CoordinationContext,
  options: CoordinateOptions = {},
): Promise<RepairJob> {
  requireText(job_id, 'job_id');
  assertAdapters(adapters);
  if (options.current_recommendation) assertRecommendationShape(options.current_recommendation);
  return withJobLock(context.repository, job_id, async () => {
    const run = await loadRun(job_id, context);
    await coordinate(run, adapters, options);
    return clone(run.job);
  });
}

async function coordinate(run: JobRun, adapters: CoordinationAdapters, options: CoordinateOptions): Promise<void> {
  const { record, job } = run;
  const open = job.status !== 'closed' && job.status !== 'cancelled';
  const runs = (stage: 'sourcing' | 'outreach' | 'publication') => options.stage === undefined || options.stage === stage;

  if (options.runtime && (record.runtime ?? 'job_queue') !== options.runtime) {
    record.runtime = options.runtime;
    run.emit({
      type: 'runtime_selected',
      summary: `Coordination runtime is now ${options.runtime}.`,
      data: { runtime: options.runtime },
    });
  }
  if (options.parts_delivery_estimate !== undefined) {
    record.parts_handoff = {
      parts_delivery_estimate: options.parts_delivery_estimate,
      reference: options.handoff_reference ?? null,
      received_at: run.nowIso(),
    };
    run.emit({
      type: 'parts_handoff_received',
      summary: `Parts handoff received: ${options.parts_delivery_estimate ?? 'nothing has to arrive'}${options.handoff_reference ? ` (message ${options.handoff_reference})` : ''}.`,
      data: record.parts_handoff,
    });
  }

  if (open && options.current_recommendation) {
    const current = options.current_recommendation;
    if (current.recommendation_id === job.recommendation_id) invalidateIfChanged(run, current);
  }

  if (runs('publication')) await publishCancelledRounds(run, adapters);

  if (job.status === 'cancelled') {
    if (runs('publication')) await publishFinal(run, adapters, 'job_cancelled', 'Repair job cancelled');
  } else if (job.status === 'closed') {
    if (runs('publication')) await publishFinal(run, adapters, 'closure_verified', 'Repair verified and closed');
  } else {
    if (PLANNING_STATUSES.includes(job.status) && (runs('sourcing') || runs('outreach'))) {
      const problem = planningProblem(run);
      if (problem) {
        run.escalate(problem.code, problem.target, problem.subject, problem.message);
        run.setStatus('awaiting_authorization', problem.message);
      } else {
        run.resolveEscalations(
          (item) => item.code === 'authority_missing' || item.code === 'authority_expired',
          'A usable authority is configured.',
        );
        if (job.status === 'blocked') startRetryRound(run);
        run.setStatus('coordinating', 'Approval and authority are valid.');
        if (runs('sourcing')) await sourceParts(run, adapters);
        if (runs('outreach')) {
          if (job.status === 'coordinating') await contactTechnicians(run, adapters);
          reconcileBooking(run);
          if (job.status === 'coordinating' && job.booking?.status === 'confirmed') {
            if (partsSupportAppointment(record, job.booking.start_at, run.config).supported) {
              run.setStatus('scheduled', 'The confirmed appointment is still supported.');
            }
          }
        }
      }
    }
    if (job.status === 'scheduled' && runs('publication')) await publishBooking(run, adapters);
  }

  if (runs('publication')) await notifyEscalations(run, adapters);
  if (record.needs_coordination && options.stage === undefined) {
    record.needs_coordination = false;
    run.markDirty();
  }
  job.parts_status = computePartsStatus(record);
  await run.persist();
}

interface PlanningProblem {
  code: string;
  target: 'authority' | 'reviewer';
  subject: string;
  message: string;
}

function planningProblem(run: JobRun): PlanningProblem | null {
  const { record } = run;
  if (!record.approval_state.valid) {
    return {
      code: 'reapproval_required',
      target: 'reviewer',
      subject: 'approval',
      message: `The approval no longer covers this job: ${record.approval_state.invalid_reason}`,
    };
  }
  const authority = authorityProblem(run);
  if (authority) return { code: authority.code, target: 'authority', subject: 'authority', message: authority.message };
  return null;
}

/** A blocked job that is coordinated again asks the suppliers and the roster afresh. */
function startRetryRound(run: JobRun): void {
  const { record } = run;
  const exhausted = run.openEscalations().some((item) => item.code === 'roster_exhausted');
  if (exhausted) {
    record.generation += 1;
    run.emit({ type: 'booking_round_started', summary: `Booking round ${record.generation} started after a retry.` });
  }
  for (const entry of activeSourcing(record)) {
    if (entry.status !== 'unavailable') continue;
    entry.round += 1;
    entry.quotes = [];
    entry.excluded_supplier_ids = [];
    entry.status = 'pending';
    entry.status_detail = `Sourcing round ${entry.round} started after a retry.`;
  }
  run.resolveEscalations((item) => RETRYABLE_BLOCKS.includes(item.code), 'Coordination was retried.');
}

function requireAuthorization(run: JobRun, refusal: ActionRefusal, subject: string): void {
  // A pending verdict is ordinary waiting, not a problem to escalate.
  if (refusal.code === 'verdict_pending') return;
  if (refusal.code === 'verdict_blocked') {
    // Already escalated when the verdict was recorded.
    if (PLANNING_STATUSES.includes(run.job.status)) run.setStatus('awaiting_authorization', refusal.message);
    return;
  }
  run.escalate(refusal.code, refusal.code.startsWith('approval') ? 'reviewer' : 'authority', subject, refusal.message);
  if (PLANNING_STATUSES.includes(run.job.status)) run.setStatus('awaiting_authorization', refusal.message);
}

async function sourceParts(run: JobRun, adapters: CoordinationAdapters): Promise<void> {
  const { record, job } = run;
  const scope = record.approved_scope;
  const authority = job.authority!;
  const version = job.recommendation_version;
  if (scope.parts.length === 0) return;

  if (adapters.suppliers.length === 0) {
    await recordNotConfigured(
      run,
      'supplier_quote',
      `supplier_quote:none:r${version}`,
      'Request supplier quotes',
      'No supplier adapter is configured, so no part was sourced.',
    );
    run.escalate('suppliers_not_configured', 'manager', 'suppliers', 'No allowed supplier is configured, so parts cannot be sourced.');
    run.setStatus('blocked', 'No allowed supplier is configured.');
    return;
  }

  let needsDecision = false;
  let unavailable = false;

  for (const part of scope.parts) {
    let entry: PartSourcing | undefined = activeSourcing(record).find((item) => item.part_id === part.part_id);
    if (!entry) {
      entry = {
        part_id: part.part_id,
        recommendation_version: version,
        approved_specification: part.approved_specification,
        quantity: part.quantity,
        unit: part.unit,
        status: 'pending',
        status_detail: 'Not sourced yet.',
        round: 1,
        quotes: [],
        excluded_supplier_ids: [],
        order: null,
      };
      record.sourcing.push(entry);
      run.markDirty();
    }
    if (entry.order && ['ordered', 'delayed', 'delivered'].includes(entry.status)) continue;

    if (part.requires_specification_review || part.approved_specification.trim() === '') {
      entry.status = 'needs_review';
      entry.status_detail = 'The approved specification is missing or marked for review.';
      run.escalate(
        'specification_review_required',
        'reviewer',
        part.part_id,
        `Part ${part.part_id} has no confirmed specification, so it was not sourced. The reviewer must supply and approve the specification.`,
      );
      needsDecision = true;
      continue;
    }

    for (const supplier of adapters.suppliers) {
      if (entry.excluded_supplier_ids.includes(supplier.supplier_id)) continue;
      if (entry.quotes.some((item) => item.supplier_id === supplier.supplier_id)) continue;
      const result = await executeAction(run, {
        action_type: 'supplier_quote',
        logical_key: `supplier_quote:${part.part_id}:r${version}:${supplier.supplier_id}:s${entry.round}`,
        mode: supplier.mode,
        summary: `Quote for ${part.quantity} ${part.unit} of ${part.part_id} from ${supplier.name}`,
        requires_approval: true,
        deduplicates_by_key: supplier.deduplicates_by_key ?? false,
        invoke: async (idempotency_key) => {
          const outcome = await supplier.requestQuote({
            idempotency_key,
            job_id: job.job_id,
            part_id: part.part_id,
            approved_specification: part.approved_specification,
            quantity: part.quantity,
            unit: part.unit,
          });
          return { ...outcome, data: { quote: outcome.quote ?? null } };
        },
      });
      if (result.kind === 'refused') return requireAuthorization(run, result, `supplier_quote:${part.part_id}`);
      const quote = (result.data as { quote: Quote | null } | null)?.quote ?? null;
      entry.quotes.push({
        supplier_id: supplier.supplier_id,
        supplier_name: supplier.name,
        action_id: result.receipt.action_id,
        mode: supplier.mode,
        status: result.receipt.status,
        classification: classifyQuote(part, result.receipt.status === 'confirmed' ? quote : null, authority.currency),
        quote,
        provider_reference: result.receipt.provider_reference,
      });
      run.markDirty();
    }

    let overAuthority = false;
    for (const candidate of rankQuotes(entry.quotes)) {
      if (entry.excluded_supplier_ids.includes(candidate.supplier_id)) continue;
      const supplier = adapters.suppliers.find((item) => item.supplier_id === candidate.supplier_id);
      const quote = candidate.quote;
      if (!supplier || !quote) continue;
      const total = Math.round(quote.unit_price_minor * part.quantity);
      const committed = committedSpendMinor(record);
      if (committed + total > authority.max_total_minor) {
        overAuthority = true;
        entry.status = 'over_authority';
        entry.status_detail = `${formatMoney(total, quote.currency)} from ${supplier.name} would exceed the spending authority.`;
        run.escalate(
          'spending_limit_exceeded',
          'authority',
          part.part_id,
          `Ordering ${part.part_id} costs ${formatMoney(total, quote.currency)}. With ${formatMoney(committed, quote.currency)} already committed it exceeds the limit of ${formatMoney(authority.max_total_minor, authority.currency)} under authority ${authority.authority_id}. Nothing was ordered.`,
        );
        break;
      }
      const result = await executeAction(run, {
        action_type: 'parts_order',
        logical_key: `parts_order:${part.part_id}:r${version}:${supplier.supplier_id}:s${entry.round}`,
        mode: supplier.mode,
        summary: `Order ${part.quantity} ${part.unit} of ${part.part_id} from ${supplier.name} for ${formatMoney(total, quote.currency)}`,
        requires_approval: true,
        deduplicates_by_key: supplier.deduplicates_by_key ?? false,
        verdict_details: {
          part_id: part.part_id,
          approved_specification: part.approved_specification,
          quantity: part.quantity,
          unit: part.unit,
          supplier_id: supplier.supplier_id,
          supplier_name: supplier.name,
          mode: supplier.mode,
          unit_price_minor: quote.unit_price_minor,
          total_minor: total,
          currency: quote.currency,
          committed_minor: committed,
          estimated_delivery_at: quote.estimated_delivery_at,
        },
        invoke: async (idempotency_key) => {
          const outcome = await supplier.placeOrder({
            idempotency_key,
            job_id: job.job_id,
            part_id: part.part_id,
            approved_specification: part.approved_specification,
            quantity: part.quantity,
            unit: part.unit,
            unit_price_minor: quote.unit_price_minor,
            total_minor: total,
            currency: quote.currency,
            quote_reference: candidate.provider_reference,
          });
          return { ...outcome, data: { estimated_delivery_at: outcome.estimated_delivery_at ?? null } };
        },
      });
      if (result.kind === 'refused') return requireAuthorization(run, result, `parts_order:${part.part_id}`);
      const status = result.receipt.status;
      if (status === 'failed' || status === 'not_configured') {
        entry.excluded_supplier_ids.push(supplier.supplier_id);
        run.emit({
          type: 'order_not_placed',
          summary: `${supplier.name} did not take the order for ${part.part_id}: ${result.receipt.detail}`,
          action_id: result.receipt.action_id,
          mode: supplier.mode,
        });
        continue;
      }
      const estimate =
        (result.data as { estimated_delivery_at: string | null } | null)?.estimated_delivery_at ??
        quote.estimated_delivery_at;
      entry.order = {
        supplier_id: supplier.supplier_id,
        supplier_name: supplier.name,
        action_id: result.receipt.action_id,
        mode: supplier.mode,
        provider_reference: result.receipt.provider_reference,
        unit_price_minor: quote.unit_price_minor,
        total_minor: total,
        currency: quote.currency,
        quantity_available_at_quote: quote.quantity_available,
        estimated_delivery_at: estimate,
        purchase_outcome: status,
        delivered_at: null,
      };
      entry.status = 'ordered';
      entry.status_detail = `Ordered from ${supplier.name}; purchase outcome ${status}.`;
      if (estimate) run.scheduleFollowUp('parts_delivery', part.part_id, estimate);
      run.markDirty();
      break;
    }

    if (entry.order) continue;
    if (overAuthority) {
      needsDecision = true;
      continue;
    }
    const substitutions = entry.quotes.filter((item) => item.classification === 'substitution' && item.quote);
    if (substitutions.length > 0) {
      entry.status = 'needs_review';
      entry.status_detail = 'Only substitutions were offered. None was accepted.';
      const offers = substitutions
        .map((item) => `${item.supplier_name} offered ${item.quote!.offered_part_id} ("${item.quote!.offered_specification}")`)
        .join('; ');
      run.escalate(
        'substitution_proposed',
        'reviewer',
        part.part_id,
        `No allowed supplier offered ${part.part_id} as approved. ${offers}. No substitution was accepted; the reviewer must decide.`,
      );
      needsDecision = true;
    } else {
      entry.status = 'unavailable';
      entry.status_detail = 'No allowed supplier could supply the approved part and quantity.';
      run.escalate(
        'part_unavailable',
        'manager',
        part.part_id,
        `No allowed supplier could supply ${part.quantity} ${part.unit} of ${part.part_id} as approved.`,
      );
      unavailable = true;
    }
  }

  job.parts_status = computePartsStatus(record);
  run.markDirty();
  if (needsDecision) {
    run.setStatus('awaiting_authorization', 'A part needs a reviewer or authority decision before it can be ordered.');
  } else if (unavailable) {
    run.setStatus('blocked', 'An approved part could not be sourced from the allowed suppliers.');
  }
}

async function contactTechnicians(run: JobRun, adapters: CoordinationAdapters): Promise<void> {
  const { record, job } = run;
  const waiting = currentOffers(record).some((offer) =>
    ['awaiting_response', 'accepted', 'confirmed'].includes(offer.status),
  );
  if (waiting) return;

  const roster = adapters.roster;
  const communication = adapters.communication;
  if (!roster || !communication) {
    await recordNotConfigured(
      run,
      'technician_contact',
      `technician_contact:none:g${record.generation}`,
      'Contact technicians',
      `No ${roster ? 'communication adapter' : 'technician roster'} is configured, so no technician was contacted.`,
    );
    run.escalate('outreach_not_configured', 'manager', 'outreach', 'Technician outreach is not configured.');
    run.setStatus('blocked', 'Technician outreach is not configured.');
    return;
  }

  const plan = planParts(record);
  if (!plan.plannable) return;
  let partsDelivery = plan.latest_delivery_at;
  if (run.requiresVerdicts) {
    // Band runtime: the appointment is planned from the estimate handed over in the room.
    const handoff = record.parts_handoff ?? null;
    if (!handoff) {
      if (!record.events.some((item) => item.type === 'parts_handoff_missing')) {
        run.emit({
          type: 'parts_handoff_missing',
          summary: 'Technician planning waits for the parts handoff in the Band room.',
        });
      }
      return;
    }
    partsDelivery = handoff.parts_delivery_estimate;
  }
  const hasException = record.exceptions.some((item) => item.exception === 'schedule_before_parts');
  let earliest = run.nowMs();
  if (partsDelivery && !hasException) {
    earliest = Math.max(earliest, Date.parse(partsDelivery) + run.config.parts_buffer_minutes * 60_000);
  }
  if (record.requirements.earliest_start_at) {
    earliest = Math.max(earliest, Date.parse(record.requirements.earliest_start_at));
  }
  let latest = run.nowMs() + run.config.scheduling_horizon_days * 86_400_000;
  if (record.requirements.latest_end_at) latest = Math.min(latest, Date.parse(record.requirements.latest_end_at));

  let shortlist = record.shortlists.find((item) => item.generation === record.generation);
  if (!shortlist) {
    const technicians = await roster.listTechnicians({ site_id: job.site_id, asset_id: job.asset_id });
    shortlist = buildShortlist(technicians, {
      generation: record.generation,
      site_id: job.site_id,
      requirements: record.requirements,
      earliest_start_ms: earliest,
      latest_end_ms: latest,
      excluded_technician_ids: record.excluded_technician_ids,
      shortlist_size: run.config.shortlist_size,
      built_at: run.nowIso(),
    });
    record.shortlists.push(shortlist);
    run.emit({
      type: 'shortlist_built',
      summary: `Booking round ${record.generation}: shortlisted ${shortlist.selected.map((item) => item.technician_name).join(', ') || 'nobody'} from the approved roster (${roster.mode}).`,
      mode: roster.mode,
      data: shortlist,
    });
    const contacts = new Map(technicians.map((item) => [item.technician_id, item.contact]));
    for (const entry of shortlist.selected) {
      const contact = contacts.get(entry.technician_id);
      if (contact) rosterContacts.set(`${job.job_id}:${entry.technician_id}`, contact);
    }
  }

  for (const candidate of shortlist.selected) {
    if (record.excluded_technician_ids.includes(candidate.technician_id)) continue;
    if (currentOffers(record).some((offer) => offer.technician_id === candidate.technician_id)) continue;
    let contact = rosterContacts.get(`${job.job_id}:${candidate.technician_id}`);
    if (!contact) {
      const technicians = await roster.listTechnicians({ site_id: job.site_id, asset_id: job.asset_id });
      contact = technicians.find((item) => item.technician_id === candidate.technician_id)?.contact;
      if (!contact) continue;
    }
    const respondBy = addMinutes(run.nowIso(), run.config.technician_response_minutes);
    const reachable = contact;
    const result = await executeAction(run, {
      action_type: 'technician_contact',
      logical_key: `technician_contact:${candidate.technician_id}:g${record.generation}`,
      mode: communication.mode,
      summary: `Offer ${candidate.start_at} to ${candidate.technician_name} by ${communication.channel}`,
      requires_approval: true,
      deduplicates_by_key: communication.deduplicates_by_key ?? false,
      invoke: (idempotency_key) =>
        communication.send({
          idempotency_key,
          job_id: job.job_id,
          purpose: 'technician_offer',
          recipient: {
            role: 'technician',
            id: candidate.technician_id,
            name: candidate.technician_name,
            address: reachable.address,
          },
          subject: `${communication.mode === 'live' ? '' : `[${communication.mode.toUpperCase()}] `}Repair job ${job.job_id} at site ${job.site_id}`,
          body: [
            `Can you take repair job ${job.job_id} on asset ${job.asset_id} at site ${job.site_id}?`,
            `Proposed appointment: ${candidate.start_at} to ${candidate.end_at}.`,
            `Approved scope: ${record.approved_scope.repair_scope}`,
            `Please reply ACCEPT or DECLINE by ${respondBy}.`,
          ].join('\n'),
        }),
    });
    if (result.kind === 'refused') return requireAuthorization(run, result, 'technician_contact');

    record.counters.offer += 1;
    const sent = !['failed', 'not_configured'].includes(result.receipt.status);
    const offer: TechnicianOffer = {
      offer_id: `${job.job_id}-OFF-${pad(record.counters.offer)}`,
      generation: record.generation,
      technician_id: candidate.technician_id,
      technician_name: candidate.technician_name,
      contact: reachable,
      start_at: candidate.start_at,
      end_at: candidate.end_at,
      status: sent ? 'awaiting_response' : 'send_failed',
      offer_action_id: result.receipt.action_id,
      respond_by: sent ? respondBy : null,
      acceptance_evidence_id: null,
      acceptance_reference: null,
      acceptance_mode: null,
      booking_action_id: null,
      closed_reason: sent ? null : result.receipt.detail,
    };
    record.offers.push(offer);
    run.markDirty();
    if (!sent) continue;
    job.booking = {
      technician_id: offer.technician_id,
      technician_name: offer.technician_name,
      start_at: offer.start_at,
      end_at: offer.end_at,
      status: 'proposed',
      confirmation_action_id: null,
    };
    run.scheduleFollowUp('technician_response', offer.offer_id, respondBy);
    return;
  }

  run.escalate(
    'roster_exhausted',
    'manager',
    `g${record.generation}`,
    `No technician on the approved roster took the job in booking round ${record.generation}. ${shortlist.selected.length} were shortlisted; ${shortlist.excluded.length} did not qualify.`,
  );
  run.setStatus('blocked', 'No technician on the approved roster is available for this job.');
}

/** Contact details stay out of the shortlist record; they are looked up again when absent. */
const rosterContacts = new Map<string, { channel: string; address: string }>();

function buildRow(run: JobRun): ScheduleRow {
  const { job } = run;
  const booking = job.booking && job.booking.status !== 'cancelled' ? job.booking : null;
  return {
    job_id: job.job_id,
    asset_id: job.asset_id,
    site_id: job.site_id,
    technician_id: booking?.technician_id ?? null,
    technician_name: booking?.technician_name ?? null,
    start_at: booking?.start_at ?? null,
    end_at: booking?.end_at ?? null,
    parts_status: job.parts_status,
    job_status: job.status,
    last_updated_at: run.nowIso(),
  };
}

async function syncSchedule(
  run: JobRun,
  adapters: CoordinationAdapters,
  reason: ScheduleSyncReason,
  suffix: string,
  retry: boolean,
): Promise<ActionResult> {
  const logical_key = `schedule_sync:${reason}:${suffix}`;
  const summary = `Update the schedule workbook (${reason})`;
  const schedule = adapters.schedule;
  if (!schedule) {
    return recordNotConfigured(
      run,
      'schedule_sync',
      logical_key,
      summary,
      'No schedule adapter is configured, so the schedule workbook was not updated.',
    );
  }
  run.job.parts_status = computePartsStatus(run.record);
  return executeAction(run, {
    action_type: 'schedule_sync',
    logical_key,
    mode: schedule.mode,
    summary,
    requires_approval: false,
    deduplicates_by_key: schedule.deduplicates_by_key ?? false,
    retry_failed: retry,
    invoke: async (idempotency_key) => {
      const receipt = await schedule.syncSchedule({
        job_id: run.job.job_id,
        idempotency_key,
        reason,
        row: buildRow(run),
        job: clone(run.job),
      });
      if (receipt === null || typeof receipt !== 'object') {
        return { status: 'failed', provider_reference: null, detail: 'The schedule adapter returned no receipt.', raw: receipt };
      }
      if (receipt.action_type !== 'schedule_sync' || receipt.job_id !== run.job.job_id) {
        return {
          status: 'failed',
          provider_reference: null,
          detail: `The schedule adapter returned a receipt for ${receipt.action_type} on job ${receipt.job_id}; it was not counted as an update.`,
          raw: receipt,
        };
      }
      const modeNote = receipt.mode === schedule.mode ? '' : ` (the adapter receipt reported mode ${receipt.mode})`;
      return {
        status: receipt.status,
        provider_reference: receipt.provider_reference ?? null,
        detail: `${receipt.detail}${modeNote}`,
        raw: receipt,
      };
    },
  });
}

/** Records what a schedule sync produced and arranges the retry. Returns true on success. */
function settleSync(run: JobRun, result: ActionResult, reason: ScheduleSyncReason, suffix: string): boolean {
  const subject = `${reason}:${suffix}`;
  if (result.kind === 'refused') {
    run.escalate(result.code, 'authority', 'schedule_sync', result.message);
    return false;
  }
  const status = result.receipt.status;
  if (status === 'confirmed') {
    run.closeFollowUps((item) => item.kind === 'schedule_sync_retry' && item.subject === subject, 'done', 'Workbook updated.');
    run.resolveEscalations(
      (item) => ['schedule_sync_failed', 'schedule_not_configured'].includes(item.code) && item.subject === subject,
      'The schedule workbook was updated.',
    );
    return true;
  }
  if (status === 'not_configured') {
    run.escalate('schedule_not_configured', 'manager', subject, 'The schedule workbook was not updated because no schedule adapter is configured.');
    return false;
  }
  const attempts = run.record.ledger.filter((entry) => entry.logical_key === `schedule_sync:${subject}`).length;
  if (attempts < run.config.max_action_attempts) {
    run.scheduleFollowUp(
      'schedule_sync_retry',
      subject,
      addMinutes(run.nowIso(), run.config.retry_delay_minutes),
      attempts + 1,
    );
  } else {
    run.escalate(
      'schedule_sync_failed',
      'manager',
      subject,
      `The schedule workbook could not be updated after ${attempts} attempts: ${result.receipt.detail}`,
    );
  }
  return false;
}

async function notifyManager(
  run: JobRun,
  adapters: CoordinationAdapters,
  topic: string,
  headline: string,
): Promise<ActionResult> {
  const logical_key = `manager_notify:${topic}`;
  const summary = `Inform the manager: ${headline}`;
  const communication = adapters.communication;
  const manager = adapters.manager;
  if (!communication || !manager) {
    return recordNotConfigured(
      run,
      'manager_notify',
      logical_key,
      summary,
      `No ${communication ? 'manager contact' : 'communication adapter'} is configured, so the manager was not informed.`,
    );
  }
  const known = run.record.ledger.some((entry) => entry.logical_key === logical_key && entry.state === 'recorded');
  const result = await executeAction(run, {
    action_type: 'manager_notify',
    logical_key,
    mode: communication.mode,
    summary,
    requires_approval: false,
    deduplicates_by_key: communication.deduplicates_by_key ?? false,
    invoke: (idempotency_key) => {
      const update = composeManagerUpdate(run.record, headline);
      return communication.send({
        idempotency_key,
        job_id: run.job.job_id,
        purpose: 'manager_update',
        recipient: { role: 'manager', id: manager.manager_id, name: manager.name, address: manager.address },
        subject: update.subject,
        body: update.body,
      });
    },
  });
  if (result.kind === 'refused' && !known) {
    run.escalate(result.code, 'authority', 'manager_notify', result.message);
  }
  return result;
}

async function publishBooking(run: JobRun, adapters: CoordinationAdapters): Promise<void> {
  const offer = currentOffers(run.record).find((item) => item.status === 'confirmed');
  if (!offer) return;
  const suffix = `g${offer.generation}`;
  const synced = settleSync(run, await syncSchedule(run, adapters, 'booking_confirmed', suffix, false), 'booking_confirmed', suffix);
  await notifyManager(
    run,
    adapters,
    `booking_confirmed:${suffix}`,
    synced
      ? `Repair booked with ${offer.technician_name} for ${offer.start_at}`
      : `Repair booked with ${offer.technician_name} for ${offer.start_at}, but the schedule workbook was NOT updated`,
  );
}

async function publishCancelledRounds(run: JobRun, adapters: CoordinationAdapters): Promise<void> {
  const cancelled = run.record.offers.filter((offer) => offer.status === 'cancelled' && offer.booking_action_id !== null);
  for (const offer of cancelled) {
    const suffix = `g${offer.generation}`;
    const done = run.record.ledger.some(
      (entry) => entry.logical_key === `manager_notify:booking_cancelled:${suffix}` && entry.state === 'recorded',
    );
    if (done) continue;
    const synced = settleSync(run, await syncSchedule(run, adapters, 'booking_cancelled', suffix, false), 'booking_cancelled', suffix);
    await notifyManager(
      run,
      adapters,
      `booking_cancelled:${suffix}`,
      `Appointment with ${offer.technician_name} cancelled (${offer.closed_reason ?? 'no reason given'})${synced ? '' : '; the schedule workbook was NOT updated'}`,
    );
  }
}

async function publishFinal(
  run: JobRun,
  adapters: CoordinationAdapters,
  reason: 'closure_verified' | 'job_cancelled',
  headline: string,
): Promise<void> {
  const done = run.record.ledger.some(
    (entry) => entry.logical_key === `manager_notify:${reason}` && entry.state === 'recorded',
  );
  if (done) return;
  const synced = settleSync(run, await syncSchedule(run, adapters, reason, 'final', false), reason, 'final');
  run.emit({
    type: reason === 'closure_verified' ? 'closure_published' : 'cancellation_published',
    summary: `${headline}. Schedule workbook ${synced ? 'updated' : 'NOT updated'}.`,
    data: { schedule_updated: synced },
  });
  await notifyManager(run, adapters, reason, synced ? headline : `${headline}, but the schedule workbook was NOT updated`);
}

/** Tells the manager once about every escalation that was raised since the last update. */
async function notifyEscalations(run: JobRun, adapters: CoordinationAdapters): Promise<void> {
  const { record } = run;
  const fresh = run.openEscalations().filter((item) => !record.notified_escalation_ids.includes(item.escalation_id));
  if (fresh.length === 0) return;
  const ids = fresh.map((item) => item.escalation_id).sort();
  const result = await notifyManager(
    run,
    adapters,
    `escalations:${ids.join('+')}`,
    `Attention needed: ${fresh.map((item) => item.code).join(', ')}`,
  );
  if (result.kind === 'recorded') {
    record.notified_escalation_ids.push(...ids);
    run.markDirty();
  }
}

/* ------------------------------------------------------------------ */
/* Follow-up worker (baseline job queue)                               */
/* ------------------------------------------------------------------ */

async function handleFollowUp(run: JobRun, followUp: FollowUp, adapters: CoordinationAdapters): Promise<string> {
  const { record, job } = run;
  const close = (outcome: string): string => {
    run.closeFollowUps((item) => item.follow_up_id === followUp.follow_up_id, 'done', outcome);
    return outcome;
  };

  switch (followUp.kind) {
    case 'technician_response': {
      const offer = record.offers.find((item) => item.offer_id === followUp.subject);
      if (!offer || offer.status !== 'awaiting_response') return close('The technician had already answered.');
      offer.status = 'no_response';
      offer.closed_reason = `No reply by ${followUp.due_at}.`;
      if (job.booking?.technician_id === offer.technician_id && job.booking.status === 'proposed') job.booking = null;
      record.needs_coordination = true;
      return close(`${offer.technician_name} did not reply by ${followUp.due_at}. The next technician is contacted.`);
    }

    case 'parts_delivery': {
      const entry = activeSourcing(record).find((item) => item.part_id === followUp.subject);
      if (!entry || !entry.order || entry.status === 'delivered') return close('The part is delivered or no longer ordered.');
      entry.status = 'delayed';
      entry.status_detail = `The delivery estimate ${followUp.due_at} passed without a delivery confirmation.`;
      job.parts_status = computePartsStatus(record);
      run.escalate(
        'parts_late',
        'manager',
        entry.part_id,
        `${entry.part_id} from ${entry.order.supplier_name} was estimated for ${followUp.due_at} and no delivery is confirmed. A new estimate is needed from the supplier.`,
      );
      record.needs_coordination = true;
      const outcome = close(`${entry.part_id} is late: no delivery confirmed by ${followUp.due_at}.`);
      if (followUp.attempt < run.config.max_action_attempts) {
        run.scheduleFollowUp('parts_delivery', entry.part_id, addMinutes(run.nowIso(), 24 * 60), followUp.attempt + 1);
      }
      return outcome;
    }

    case 'completion_evidence': {
      const booking = job.booking;
      if (!['scheduled', 'in_progress'].includes(job.status) || !booking || booking.status !== 'confirmed') {
        return close('The job no longer waits for completion evidence.');
      }
      const offer = currentOffers(record).find((item) => item.status === 'confirmed');
      const communication = adapters.communication;
      let outcome: string;
      if (communication && offer) {
        const result = await executeAction(run, {
          action_type: 'follow_up',
          logical_key: `follow_up:completion_evidence:g${record.generation}:n${followUp.attempt}`,
          mode: communication.mode,
          summary: `Remind ${booking.technician_name} to send completion evidence (reminder ${followUp.attempt})`,
          requires_approval: false,
          deduplicates_by_key: communication.deduplicates_by_key ?? false,
          invoke: (idempotency_key) =>
            communication.send({
              idempotency_key,
              job_id: job.job_id,
              purpose: 'follow_up',
              recipient: {
                role: 'technician',
                id: booking.technician_id,
                name: booking.technician_name,
                address: offer.contact.address,
              },
              subject: `${communication.mode === 'live' ? '' : `[${communication.mode.toUpperCase()}] `}Completion evidence for job ${job.job_id}`,
              body: `The appointment for job ${job.job_id} on asset ${job.asset_id} ended at ${booking.end_at}. Please send your completion comments, photos and receipts, or tell us what is outstanding.`,
            }),
        });
        outcome =
          result.kind === 'recorded'
            ? `Reminder ${followUp.attempt} to ${booking.technician_name}: ${result.receipt.status}.`
            : `Reminder not sent: ${result.message}`;
      } else {
        outcome = 'No communication adapter is configured, so no reminder was sent.';
      }
      if (followUp.attempt >= run.config.completion_reminder_limit) {
        run.escalate(
          'completion_evidence_missing',
          'manager',
          `g${record.generation}`,
          `No completion evidence arrived for the ${booking.start_at} appointment with ${booking.technician_name} after ${followUp.attempt} reminders. The job stays open.`,
        );
      }
      record.needs_coordination = true;
      close(outcome);
      run.scheduleFollowUp(
        'completion_evidence',
        `g${record.generation}`,
        addMinutes(run.nowIso(), run.config.completion_grace_minutes),
        followUp.attempt + 1,
      );
      return outcome;
    }

    case 'verification_pending': {
      if (job.status !== 'awaiting_verification') return close('The job no longer waits for verification.');
      run.escalate(
        'verification_overdue',
        'manager',
        followUp.subject,
        `Completion evidence has waited for verification and review since ${followUp.created_at}. The job stays open until a reviewer decides.`,
      );
      record.needs_coordination = true;
      return close('Verification is overdue; the manager was told.');
    }

    case 'schedule_sync_retry': {
      const separator = followUp.subject.indexOf(':');
      const reason = followUp.subject.slice(0, separator) as ScheduleSyncReason;
      const suffix = followUp.subject.slice(separator + 1);
      const result = await syncSchedule(run, adapters, reason, suffix, true);
      const outcome = close(
        result.kind === 'recorded' ? `Retry ${followUp.attempt}: ${result.receipt.status}.` : `Retry refused: ${result.message}`,
      );
      if (settleSync(run, result, reason, suffix)) {
        await notifyManager(run, adapters, `schedule_sync_resolved:${followUp.subject}`, 'The schedule workbook is now updated');
      }
      return outcome;
    }
  }
}

/**
 * Runs every follow-up that is due on the context clock, then lets each touched job make
 * progress. Due times are persisted, so a restarted worker continues where it stopped.
 */
export async function processDueFollowUps(
  adapters: CoordinationAdapters,
  context: CoordinationContext,
): Promise<FollowUpResult[]> {
  assertAdapters(adapters);
  const clock = context.clock ?? systemClock;
  const results: FollowUpResult[] = [];
  for (const listed of await context.repository.list()) {
    const now = clock.now().getTime();
    const isDue = (item: FollowUp) => item.status === 'pending' && Date.parse(item.due_at) <= now;
    if (!listed.follow_ups.some(isDue)) continue;
    await withJobLock(context.repository, listed.job.job_id, async () => {
      const run = await loadRun(listed.job.job_id, context);
      const due = run.record.follow_ups.filter(isDue).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
      for (const followUp of due) {
        if (followUp.status !== 'pending') continue;
        const outcome = await handleFollowUp(run, followUp, adapters);
        results.push({ job_id: run.job.job_id, follow_up_id: followUp.follow_up_id, kind: followUp.kind, outcome });
      }
      await coordinate(run, adapters, {});
    });
  }
  return results;
}

/**
 * One pass of the baseline job queue: due follow-ups first, then every open job that an
 * event left work for. BAND is not used; this in-process queue is what runs.
 */
export async function runWorkerTick(
  adapters: CoordinationAdapters,
  context: CoordinationContext,
): Promise<WorkerTickResult> {
  const follow_ups = await processDueFollowUps(adapters, context);
  const coordinated_job_ids: string[] = [];
  for (const listed of await context.repository.list()) {
    if (!listed.needs_coordination) continue;
    await coordinateRepair(listed.job.job_id, adapters, context);
    coordinated_job_ids.push(listed.job.job_id);
  }
  return {
    runtime: 'job_queue',
    ran_at: toIso((context.clock ?? systemClock).now()),
    follow_ups,
    coordinated_job_ids,
  };
}

/** Chooses the runtime for a job without running any stage. The choice is persisted. */
export async function selectCoordinationRuntime(
  job_id: string,
  runtime: 'job_queue' | 'band',
  context: CoordinationContext,
): Promise<RepairJob> {
  requireText(job_id, 'job_id');
  requireOneOf(runtime, ['job_queue', 'band'], 'runtime');
  return withJobLock(context.repository, job_id, async () => {
    const run = await loadRun(job_id, context);
    if ((run.record.runtime ?? 'job_queue') !== runtime) {
      run.record.runtime = runtime;
      run.emit({
        type: 'runtime_selected',
        summary: `Coordination runtime is now ${runtime}.`,
        data: { runtime },
      });
      await run.persist();
    }
    return clone(run.job);
  });
}

/* ------------------------------------------------------------------ */
/* Read operations                                                     */
/* ------------------------------------------------------------------ */

export async function getRepairJob(job_id: string, context: CoordinationContext): Promise<RepairJob> {
  return clone((await loadRun(job_id, context)).job);
}

export async function listRepairJobs(context: CoordinationContext): Promise<RepairJob[]> {
  return (await context.repository.list()).map((record) => clone(record.job));
}

/** The persisted event history, oldest first. This is the report timeline. */
export async function getJobTimeline(job_id: string, context: CoordinationContext): Promise<TimelineEvent[]> {
  return clone((await loadRun(job_id, context)).record.events);
}

/** Everything behind the job's status: why it waits, what is due, and the evidence held. */
export async function getJobDetail(job_id: string, context: CoordinationContext): Promise<JobDetail> {
  const record = clone((await loadRun(job_id, context)).record);
  return {
    job: record.job,
    runtime: record.runtime ?? 'job_queue',
    verdict_requests: record.verdict_requests ?? [],
    parts_handoff: record.parts_handoff ?? null,
    approval_valid: record.approval_state.valid,
    approval_invalid_reason: record.approval_state.invalid_reason,
    approved_scope: record.approved_scope,
    sourcing: record.sourcing,
    generation: record.generation,
    shortlists: record.shortlists,
    offers: record.offers,
    open_escalations: record.escalations.filter((item) => item.resolved_at === null),
    resolved_escalations: record.escalations.filter((item) => item.resolved_at !== null),
    pending_follow_ups: record.follow_ups.filter((item) => item.status === 'pending'),
    exceptions: record.exceptions,
    current_completion: currentCompletion(record),
    current_completion_assessment: currentAssessment(record),
    current_verification: currentVerification(record),
    outcome_evidence: record.outcome_evidence,
    timeline: record.events,
  };
}
